import os from "node:os";
import type { GithubCli } from "../../shared/github-view.ts";
import { path_program } from "../git/locate.ts";
import { first_line, run_program, type GitOutput } from "../git/run.ts";
import { as_array, error_text, is_record, require_record } from "../storage/coerce.ts";
import type { GithubTransport, RawResponse } from "./client.ts";

export type GhAccount = { host: string; login: string; active: boolean; state: string };

export type GhStatus = { kind: "missing" } | { kind: "too_old"; exe: string; version: string | null } | { kind: "found"; exe: string; accounts: GhAccount[] };

export type GhRun = (exe: string, args: string[], signal?: AbortSignal) => Promise<GitOutput>;

export type GhProbe = { env: Record<string, string | undefined>; exists: (file: string) => boolean; run: GhRun };

export type GhCache = { status: (host: string) => Promise<GhStatus>; reread: (host: string) => Promise<GhStatus>; exe: () => string | null };

const fixed_env: Record<string, string> = { GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" };

const dropped_env = new Set(["GH_DEBUG", "DEBUG", "GH_FORCE_TTY", "CLICOLOR_FORCE", ...Object.keys(fixed_env)]);

export const host_pattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;

export const login_pattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const gh_env = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(source).filter(([name]) => !dropped_env.has(name.toUpperCase()))),
  ...fixed_env,
});

export const run_gh: GhRun = (exe, args, signal) => run_program(exe, args, { cwd: os.homedir(), env: gh_env(process.env), signal });

export const parse_auth_status = (text: string): GhAccount[] => {
  const hosts = require_record(require_record(JSON.parse(text), "gh auth status").hosts, "gh auth status hosts");
  return Object.entries(hosts).flatMap(([raw_host, entries]) => {
    const host = raw_host.toLowerCase();
    if (!host_pattern.test(host)) return [];
    return as_array(entries).flatMap((entry): GhAccount[] => {
      if (!is_record(entry) || typeof entry.login !== "string" || !login_pattern.test(entry.login) || typeof entry.state !== "string") return [];
      return [{ host, login: entry.login, active: entry.active === true, state: entry.state }];
    });
  });
};

export const parse_gh_version = (text: string): string | null => /gh version (\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;

export const find_gh = (probe: GhProbe): string | null => path_program(probe.env, probe.exists, "gh.exe");

export const read_gh_status = async (probe: GhProbe, exe: string, host: string): Promise<GhStatus> => {
  const output = await probe.run(exe, ["auth", "status", "--json", "hosts", "--hostname", host]);
  if (output.code !== 0 && /unknown flag/i.test(output.stderr)) {
    const version = await probe.run(exe, ["--version"]);
    return { kind: "too_old", exe, version: parse_gh_version(version.stdout.toString("utf8")) };
  }
  if (output.code !== 0) {
    throw new Error(`${exe} auth status for ${host} exited with ${output.code}: ${first_line(output.stderr) || "no error output"}`);
  }
  return { kind: "found", exe, accounts: parse_auth_status(output.stdout.toString("utf8")) };
};

export const host_account = (status: GhStatus, host: string): GhAccount | null => {
  if (status.kind !== "found") {
    return null;
  }
  const accounts = status.accounts.filter((account) => account.host === host);
  return accounts.find((account) => account.active) ?? accounts[0] ?? null;
};

export const cli_of = (status: GhStatus, host: string): GithubCli => {
  if (status.kind === "missing") return { state: "missing", version: null };
  if (status.kind === "too_old") return { state: "too_old", version: status.version };
  return { state: host_account(status, host) ? "ready" : "signed_out", version: null };
};

export const create_gh_cache = (probe: GhProbe): GhCache => {
  const current = new Map<string, Promise<GhStatus>>();
  let known: GhStatus | null = null;
  const read = (host: string): Promise<GhStatus> => {
    const exe = find_gh(probe);
    const read_status = exe
      ? read_gh_status(probe, exe, host).catch((error): GhStatus => {
          console.error(`[github] reading the GitHub CLI sign-in for ${host} with ${exe} failed, it counts as signed out:`, error);
          return { kind: "found", exe, accounts: [] };
        })
      : Promise.resolve<GhStatus>({ kind: "missing" });
    const next = read_status.then((status) => {
      known = status;
      return status;
    });
    current.set(host, next);
    return next;
  };
  return {
    status: (host) => current.get(host) ?? read(host),
    reread: read,
    exe: () => (known && known.kind !== "missing" ? known.exe : null),
  };
};

export const parse_gh_response = (stdout: string): RawResponse | null => {
  const status = /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/.exec(stdout);
  if (!status) {
    return null;
  }
  const rest = stdout.slice(status[0].length);
  const end = /\r?\n\r?\n/.exec(rest);
  const head = end ? rest.slice(0, end.index) : rest;
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return { status: Number(status[1]), headers, body: end ? rest.slice(end.index + end[0].length) : "" };
};

export const gh_transport =
  (exe_of: () => string | null, run: GhRun): GithubTransport =>
  async ({ host, path, headers, signal }) => {
    const exe = exe_of();
    if (!exe) {
      return { kind: "signed_out", detail: "the GitHub CLI was not found" };
    }
    const header_args = Object.entries(headers).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
    let output: GitOutput;
    try {
      output = await run(exe, ["api", "-i", "--hostname", host, ...header_args, path], signal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return { kind: "signed_out", detail: error_text(error) };
    }
    const response = parse_gh_response(output.stdout.toString("utf8"));
    if (response) {
      return { kind: "response", response };
    }
    const detail = first_line(output.stderr) || `exit code ${output.code}`;
    return output.code === 4 ? { kind: "signed_out", detail } : { kind: "offline", detail };
  };

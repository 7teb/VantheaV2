import os from "node:os";
import path from "node:path";
import type { GitRemote } from "../../shared/git-view.ts";
import { host_kind_of, parse_remote_url, type RemoteUrl } from "../../shared/git/remote-url.ts";
import { error_text } from "../storage/coerce.ts";
import { owned_scopes, type SshSettings } from "./guard.ts";
import { absolute_windows, env_value, path_program } from "./locate.ts";
import { run_program, type GitTool } from "./run.ts";

type Env = Record<string, string | undefined>;

type SshVariant = "ssh" | "plink" | "putty" | "tortoiseplink" | "simple" | "auto";

type EffectiveSsh = { text: string; shell: boolean; scope: string };

export type SshProbe = { env: Env; exists: (file: string) => boolean };

const variants: readonly SshVariant[] = ["ssh", "plink", "putty", "tortoiseplink", "simple", "auto"];

const batch_switches: Record<SshVariant, string> = {
  ssh: "-o BatchMode=yes",
  auto: "-o BatchMode=yes",
  plink: "-batch",
  putty: "-batch",
  tortoiseplink: "",
  simple: "",
};

const plain_token = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const alias_host = /^[a-z0-9_][a-z0-9._-]*$/;

export const effective_ssh = (env: Env, settings: SshSettings): EffectiveSsh => {
  const env_command = env_value(env, "GIT_SSH_COMMAND");
  if (env_command) return { text: env_command, shell: true, scope: "env" };
  const configured = settings.command;
  if (configured?.value) return { text: configured.value, shell: true, scope: configured.scope };
  const program = env_value(env, "GIT_SSH");
  if (program) return { text: program, shell: false, scope: "env" };
  return { text: "ssh", shell: false, scope: "default" };
};

export const command_program = (text: string): string => {
  const trimmed = text.trimStart();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end < 0 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split(/\s/, 1)[0] ?? "";
};

const named_variant = (env: Env, settings: SshSettings): SshVariant | null => {
  const from_env = env_value(env, "GIT_SSH_VARIANT").toLowerCase();
  const configured = settings.variant && !owned_scopes.has(settings.variant.scope) ? (settings.variant.value ?? "").toLowerCase() : "";
  return variants.find((variant) => variant === from_env) ?? variants.find((variant) => variant === configured) ?? null;
};

const ssh_variant = (env: Env, settings: SshSettings, effective: EffectiveSsh): SshVariant => {
  const named = named_variant(env, settings);
  if (named && named !== "auto") return named;
  const program = effective.shell ? command_program(effective.text) : effective.text;
  const base = path.win32.basename(program).toLowerCase().replace(/\.exe$/, "");
  if (base === "ssh") return "ssh";
  if (base === "plink") return "plink";
  if (base === "tortoiseplink") return "tortoiseplink";
  return "auto";
};

const shell_quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const fetch_ssh_command = (env: Env, settings: SshSettings): string => {
  const effective = effective_ssh(env, settings);
  const command = effective.shell || effective.scope === "default" ? effective.text : shell_quote(effective.text);
  const batch = batch_switches[ssh_variant(env, settings, effective)];
  return batch ? `${command} ${batch}` : command;
};

export const bundled_ssh = (git_exe: string, exists: (file: string) => boolean): string | null => {
  const dir = path.win32.dirname(git_exe);
  for (const root of [path.win32.dirname(dir), path.win32.dirname(path.win32.dirname(dir))]) {
    const exe = path.win32.join(root, "usr", "bin", "ssh.exe");
    if (exists(exe)) return exe;
  }
  return null;
};

export const alias_program = (probe: SshProbe, settings: SshSettings, git_exe: string): string | null => {
  const effective = effective_ssh(probe.env, settings);
  if (owned_scopes.has(effective.scope)) return null;
  const variant = ssh_variant(probe.env, settings, effective);
  if (variant !== "ssh" && variant !== "auto") return null;
  const program = effective.shell ? command_program(effective.text) : effective.text;
  if (absolute_windows.test(program)) {
    return [program, `${program}.exe`].find((file) => probe.exists(file)) ?? null;
  }
  if (!program || /[\\/]/.test(program)) return null;
  const base = program.toLowerCase().replace(/\.exe$/, "");
  if (base === "ssh") return bundled_ssh(git_exe, probe.exists);
  return path_program(probe.env, probe.exists, program.toLowerCase().endsWith(".exe") ? program : `${program}.exe`);
};

export const alias_candidate = (url: RemoteUrl): string | null => (url.scheme === "ssh" && url.host && alias_host.test(url.host) ? url.host : null);

export const ssh_hostname = (config: string, alias: string): string | null => {
  const host = /^hostname\s+(\S+)\s*$/im.exec(config)?.[1]?.toLowerCase();
  return host && host !== alias ? host : null;
};

export const resolve_alias = async (program: string, alias: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string | null> => {
  try {
    const output = await run_program(program, ["-G", "--", alias], { cwd: os.homedir(), env, signal });
    if (output.code !== 0) {
      console.warn(`[git] ${program} -G for the ssh host ${alias} exited with ${output.code}`);
      return null;
    }
    return ssh_hostname(output.stdout.toString("utf8"), alias);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[git] resolving the ssh host ${alias} with ${program} failed: ${error_text(error)}`);
    return null;
  }
};

export type SshHosts = {
  request: (remotes: GitRemote[], tool: GitTool, settings: SshSettings) => void;
  apply: (remotes: GitRemote[]) => GitRemote[];
};

type HostBasis = { tool: GitTool; settings: SshSettings; program: string | null };

const alias_of = (remote: GitRemote): string | null => alias_candidate(parse_remote_url(remote.url));

const host_key = (program: string, alias: string): string => `${program}\n${alias}`;

export const create_ssh_hosts = (probe: SshProbe, signal: AbortSignal, on_resolved: () => void): SshHosts => {
  const hosts = new Map<string, string | null>();
  let basis: HostBasis | null = null;

  return {
    request: (remotes, tool, settings) => {
      const aliases = new Set(remotes.map(alias_of).filter((alias) => alias !== null));
      if (aliases.size === 0) return;
      if (!basis || basis.tool !== tool || basis.settings !== settings) basis = { tool, settings, program: alias_program(probe, settings, tool.exe) };
      const { program } = basis;
      if (!program) return;
      for (const alias of aliases) {
        const key = host_key(program, alias);
        if (hosts.has(key)) continue;
        hosts.set(key, null);
        resolve_alias(program, alias, probe.env, signal)
          .then((host) => {
            if (!host) return;
            hosts.set(key, host);
            on_resolved();
          })
          .catch((error) => {
            if (!signal.aborted) console.error(`[git] resolving the ssh host ${alias} with ${program} failed:`, error);
          });
      }
    },
    apply: (remotes) => {
      const program = basis?.program;
      if (!program) return remotes;
      return remotes.map((remote) => {
        const alias = alias_of(remote);
        const host = alias ? hosts.get(host_key(program, alias)) : null;
        return host ? { ...remote, host, host_kind: host_kind_of(host) } : remote;
      });
    },
  };
};

export const ssh_test_command = (url: string): string | null => {
  const parsed = parse_remote_url(url);
  if (parsed.scheme !== "ssh" || !parsed.host || !plain_token.test(parsed.host)) return null;
  const user = parsed.user ?? (parsed.host_kind === "ghe_com" ? parsed.host.slice(0, parsed.host.indexOf(".")) : "git");
  if (!plain_token.test(user)) return null;
  const port = parsed.port !== null && parsed.port !== 22 ? `-p ${parsed.port} ` : "";
  return `ssh -T ${port}${user}@${parsed.host}`;
};

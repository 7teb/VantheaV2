import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { rgPath } from "@vscode/ripgrep";
import type { GrepMatch } from "../../shared/tool-view.ts";
import { error_text } from "../storage/coerce.ts";
import { ignored_dirs } from "./index.ts";
import { is_secret_path, resolve_inside } from "./scope.ts";

export type GrepQuery = { query: string; path: string; regex: boolean; case_sensitive: boolean };

export type GrepResult = {
  mode: "literal" | "regex";
  regex_error: string | null;
  matches: GrepMatch[];
  capped: boolean;
  files_scanned: number;
};

export const max_grep_matches = 200;

export const max_grep_line_chars = 300;

const rg_binary = rgPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

type RgRun = { matches: GrepMatch[]; capped: boolean; files_scanned: number; error: string | null };

type RgMessage = {
  type?: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string; bytes?: string };
    stats?: { searches?: number };
  };
};

const posix = (value: string) => value.split(path.sep).join("/");

const line_text = (lines: { text?: string; bytes?: string } | undefined): string =>
  (lines?.text ?? (lines?.bytes ? Buffer.from(lines.bytes, "base64").toString("utf8") : "")).replace(/\r?\n$/, "").slice(0, max_grep_line_chars);

const rg_args = (query: GrepQuery, literal: boolean, target: string): string[] => [
  "--json",
  "--no-config",
  "--hidden",
  "--no-require-git",
  query.case_sensitive ? "--case-sensitive" : "--ignore-case",
  ...(literal ? ["--fixed-strings"] : ["--engine", "auto"]),
  ...[...ignored_dirs].flatMap((name) => ["--glob", `!**/${name}/**`]),
  "--regexp",
  query.query,
  "--",
  target,
];

const run_rg = (root: string, args: string[], signal: AbortSignal, on_match?: (count: number) => void): Promise<RgRun> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(rg_binary, args, { cwd: root, windowsHide: true });
    const run: RgRun = { matches: [], capped: false, files_scanned: 0, error: null };
    let stderr = "";
    let settled = false;
    const finish = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", on_abort);
      if (error) {
        reject(error);
        return;
      }
      resolve(run);
    };
    const on_abort = () => {
      child.kill();
    };
    signal.addEventListener("abort", on_abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (raw) => {
      if (run.capped) {
        return;
      }
      let message: RgMessage;
      try {
        message = JSON.parse(raw) as RgMessage;
      } catch (error) {
        console.warn(`[project] ripgrep printed a line that is not JSON (${error_text(error)}): ${raw.slice(0, 200)}`);
        return;
      }
      if (message.type === "summary") {
        run.files_scanned = message.data?.stats?.searches ?? run.files_scanned;
        return;
      }
      if (message.type !== "match" || !message.data?.path?.text || !message.data.line_number) {
        return;
      }
      const relative = posix(path.relative(root, path.resolve(root, message.data.path.text)));
      if (is_secret_path(relative)) {
        return;
      }
      run.matches.push({ path: relative, line: message.data.line_number, text: line_text(message.data.lines) });
      on_match?.(run.matches.length);
      if (run.matches.length > max_grep_matches) {
        run.capped = true;
        child.kill();
      }
    });
    child.on("error", (error) => finish(new Error(`ripgrep could not start from ${rg_binary}: ${error_text(error)}`)));
    child.on("close", (code) => {
      if (signal.aborted) {
        finish(signal.reason);
        return;
      }
      if (code === 2 && !run.capped) {
        run.error = stderr.trim() || "ripgrep failed without a message";
      }
      finish(null);
    });
  });

const search_target = async (project_root: string, scope: string) => {
  const scoped = await resolve_inside(project_root, scope || ".");
  const stat = await fs.stat(scoped.target);
  if (stat.isFile() && is_secret_path(scoped.relative)) {
    throw new Error("Secret files are not readable by the agent");
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error(`${scope} is not a file or directory`);
  }
  return scoped;
};

const sorted = (matches: GrepMatch[]): GrepMatch[] => matches.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));

const result_of = (run: RgRun, mode: GrepResult["mode"], regex_error: string | null): GrepResult => ({
  mode,
  regex_error,
  matches: sorted(run.matches).slice(0, max_grep_matches),
  capped: run.capped,
  files_scanned: run.files_scanned,
});

export const grep_project = async (project_root: string, query: GrepQuery, signal: AbortSignal, on_match?: (count: number) => void): Promise<GrepResult> => {
  if (!query.query.trim()) {
    return { mode: query.regex ? "regex" : "literal", regex_error: null, matches: [], capped: false, files_scanned: 0 };
  }
  const scoped = await search_target(project_root, query.path);
  if (query.regex) {
    const run = await run_rg(scoped.root, rg_args(query, false, scoped.target), signal, on_match);
    if (!run.error) {
      return result_of(run, "regex", null);
    }
    if (run.matches.length === 0 && /regex/i.test(run.error)) {
      console.warn(`[project] grep regex ${query.query.slice(0, 200)} is invalid, matching literally: ${run.error}`);
      return result_of(await run_rg(scoped.root, rg_args(query, true, scoped.target), signal, on_match), "literal", run.error);
    }
    console.warn(`[project] ripgrep reported errors for ${query.query.slice(0, 200)}: ${run.error}`);
    return result_of(run, "regex", null);
  }
  const run = await run_rg(scoped.root, rg_args(query, true, scoped.target), signal, on_match);
  if (run.error) {
    console.warn(`[project] ripgrep reported errors for ${query.query.slice(0, 200)}: ${run.error}`);
  }
  return result_of(run, "literal", null);
};

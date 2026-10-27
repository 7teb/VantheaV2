import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { rgPath } from "@vscode/ripgrep";
import type { GrepMatch } from "../../shared/tool-view.ts";
import { error_text } from "../storage/coerce.ts";
import { ignored_dirs } from "./index.ts";
import { encoding_batches, find_utf16_files, type Utf16Encoding } from "./grep-encoding.ts";
import { is_secret_path } from "../../shared/secret-path.ts";
import { resolve_inside, type ScopedPath } from "./scope.ts";

export type GrepQuery = { query: string; path: string; regex: boolean; case_sensitive: boolean };

export type GrepTarget = ScopedPath & { file: boolean };

export type GrepResult = {
  mode: "literal" | "regex";
  regex_error: string | null;
  matches: GrepMatch[];
  capped: boolean;
  files_scanned: number | null;
  incomplete: string | null;
};

export const max_grep_matches = 200;

export const max_grep_line_chars = 300;

const rg_binary = rgPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

type RgRun = { matches: GrepMatch[]; capped: boolean; files_scanned: number | null; finished: boolean; error: string | null };

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

const rg_filters = ["--no-config", "--hidden", "--no-require-git", ...[...ignored_dirs].flatMap((name) => ["--glob", `!**/${name}/**`])];

const rg_args = (query: GrepQuery, literal: boolean, targets: string[], encoding?: Utf16Encoding): string[] => [
  "--json",
  ...rg_filters,
  ...(encoding ? ["--encoding", encoding] : []),
  query.case_sensitive ? "--case-sensitive" : "--ignore-case",
  ...(literal ? ["--fixed-strings"] : ["--engine", "auto"]),
  "--regexp",
  query.query,
  "--",
  ...targets,
];

const run_rg = (root: string, args: string[], signal: AbortSignal, hidden: (relative: string) => boolean, on_match?: (count: number) => void, limit = max_grep_matches, excluded: ReadonlySet<string> = new Set()): Promise<RgRun> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(rg_binary, args, { cwd: root, windowsHide: true });
    const run: RgRun = { matches: [], capped: false, files_scanned: 0, finished: false, error: null };
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
        run.finished = true;
        run.files_scanned = message.data?.stats?.searches ?? run.files_scanned;
        return;
      }
      if (message.type !== "match" || !message.data?.path?.text || !message.data.line_number) {
        return;
      }
      const relative = posix(path.relative(root, path.resolve(root, message.data.path.text)));
      if (hidden(relative) || excluded.has(relative.toLowerCase())) {
        return;
      }
      run.matches.push({ path: relative, line: message.data.line_number, text: line_text(message.data.lines) });
      on_match?.(run.matches.length);
      if (run.matches.length > limit) {
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

export const grep_target = async (project_root: string, scope: string): Promise<GrepTarget> => {
  const scoped = await resolve_inside(project_root, scope || ".");
  const stat = await fs.stat(scoped.target);
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error(`${scope} is not a file or directory`);
  }
  return { ...scoped, file: stat.isFile() };
};

const sorted = (matches: GrepMatch[]): GrepMatch[] => matches.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));

const result_of = (run: RgRun, root: string, query: GrepQuery, mode: GrepResult["mode"], regex_error: string | null): GrepResult => {
  if (run.error && !run.finished) {
    throw new Error(`ripgrep failed before searching: ${run.error}`);
  }
  const incomplete = run.error ? run.error.split(`${root}${path.sep}`).join("") : null;
  if (incomplete) {
    console.warn(`[project] ripgrep could not search everything for ${query.query.slice(0, 200)}: ${incomplete.slice(0, 2000)}`);
  }
  return { mode, regex_error, matches: sorted(run.matches).slice(0, max_grep_matches), capped: run.capped, files_scanned: run.finished && !run.error && !run.capped ? run.files_scanned : null, incomplete };
};

export const grep_project = async (scoped: GrepTarget, query: GrepQuery, signal: AbortSignal, on_match?: (count: number) => void): Promise<GrepResult> => {
  if (!query.query.trim()) {
    return { mode: query.regex ? "regex" : "literal", regex_error: null, matches: [], capped: false, files_scanned: 0, incomplete: null };
  }
  const hidden = is_secret_path(scoped.relative) ? () => false : is_secret_path;
  const search = async (literal: boolean): Promise<RgRun> => {
    let run = await run_rg(scoped.root, rg_args(query, literal, [scoped.target]), signal, hidden, on_match);
    if (!run.finished && !run.capped) {
      return run;
    }
    if (run.capped) {
      const files = [...new Set(run.matches.map(match => path.resolve(scoped.root, match.path)))];
      const checked = await find_utf16_files(rg_binary, rg_filters, scoped.root, scoped.target, scoped.file, hidden, signal, files);
      if (!checked.error && !checked.groups["utf-16le"].length && !checked.groups["utf-16be"].length) {
        return run;
      }
    }
    const encoded = await find_utf16_files(rg_binary, rg_filters, scoped.root, scoped.target, scoped.file, hidden, signal);
    const excluded = new Set([...encoded.groups["utf-16le"], ...encoded.groups["utf-16be"]].map(file => posix(path.relative(scoped.root, file)).toLowerCase()));
    if (run.matches.some(match => excluded.has(match.path.toLowerCase()))) {
      run = await run_rg(scoped.root, rg_args(query, literal, [scoped.target]), signal, hidden, on_match, max_grep_matches, excluded);
    }
    if (excluded.size) {
      run.files_scanned = scoped.file ? 1 : null;
    }
    const append_error = (error: string | null) => {
      if (error) {
        run.error = run.error ? `${run.error}\n${error}` : error;
      }
    };
    append_error(encoded.error);
    if (run.capped) {
      return run;
    }
    for (const encoding of ["utf-16le", "utf-16be"] as const) {
      for (const targets of encoding_batches(encoded.groups[encoding], query.query.length + rg_filters.join(" ").length + rg_binary.length + 200)) {
        const before = run.matches.length;
        const extra = await run_rg(scoped.root, rg_args(query, literal, targets, encoding), signal, hidden, (count) => on_match?.(before + count), max_grep_matches - before);
        run.matches.push(...extra.matches);
        run.capped ||= extra.capped;
        append_error(extra.error);
        if (run.capped) {
          return run;
        }
      }
    }
    return run;
  };
  if (!query.regex) {
    return result_of(await search(true), scoped.root, query, "literal", null);
  }
  const run = await search(false);
  if (!run.error || run.finished) {
    return result_of(run, scoped.root, query, "regex", null);
  }
  console.warn(`[project] grep regex ${query.query.slice(0, 200)} does not compile, matching literally: ${run.error}`);
  return result_of(await search(true), scoped.root, query, "literal", run.error);
};

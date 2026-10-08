import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { GrepMatch } from "../../shared/tool-view.ts";
import { error_text } from "../storage/coerce.ts";
import { decode_text, looks_binary, text_stream } from "../storage/text-codec.ts";
import { walk_project } from "./index.ts";
import { RegexWorkerError, start_regex_search } from "./regex-search.ts";
import { is_secret_path, resolve_inside } from "./scope.ts";

export type GrepQuery = { query: string; path: string; regex: boolean; case_sensitive: boolean };

export type GrepResult = {
  mode: "literal" | "regex";
  regex_error: string | null;
  matches: GrepMatch[];
  capped: boolean;
  timed_out: boolean;
  files_scanned: number;
};

export const max_grep_matches = 200;

export const max_grep_line_chars = 300;

export const regex_budget_ms = 10_000;

const stream_threshold = 2 * 1024 * 1024;

const stream_batch_lines = 5000;

type Matcher = {
  mode: GrepResult["mode"];
  regex_error: string | null;
  select: (lines: string[], limit: number) => Promise<number[]>;
  timed_out: () => boolean;
  close: () => void;
};

const literal_matcher = (query: GrepQuery): Matcher => {
  const needle = query.case_sensitive ? query.query : query.query.toLowerCase();
  const test = query.case_sensitive ? (line: string) => line.includes(needle) : (line: string) => line.toLowerCase().includes(needle);
  return {
    mode: "literal",
    regex_error: null,
    select: async (lines, limit) => {
      const hits: number[] = [];
      for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
        if (test(lines[index])) {
          hits.push(index);
        }
      }
      return hits;
    },
    timed_out: () => false,
    close: () => undefined,
  };
};

const build_matcher = (query: GrepQuery, signal: AbortSignal): Matcher => {
  if (!query.regex) {
    return literal_matcher(query);
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(query.query, query.case_sensitive ? "" : "i");
  } catch (error) {
    const regex_error = error_text(error);
    console.warn(`[project] grep regex ${query.query.slice(0, 200)} is invalid, matching literally: ${regex_error}`);
    return { ...literal_matcher(query), regex_error };
  }
  return { mode: "regex", regex_error: null, ...start_regex_search(pattern, regex_budget_ms, signal) };
};

const match_of = (file: string, line: number, text: string): GrepMatch => ({ path: file, line, text: text.slice(0, max_grep_line_chars) });

const collect = async (matcher: Matcher, lines: string[], first_line: number, file: string, matches: GrepMatch[], limit: number) => {
  for (const index of await matcher.select(lines, limit - matches.length)) {
    matches.push(match_of(file, first_line + index, lines[index]));
  }
};

const scan_small = async (absolute: string, file: string, matcher: Matcher, matches: GrepMatch[], limit: number) => {
  const { text } = decode_text(await fs.readFile(absolute));
  if (looks_binary(text)) {
    return;
  }
  await collect(matcher, text.split(/\r?\n/), 1, file, matches, limit);
};

const scan_stream = async (absolute: string, file: string, matcher: Matcher, matches: GrepMatch[], limit: number) => {
  const { stream } = await text_stream(absolute);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch: string[] = [];
  let first_line = 1;
  try {
    for await (const line of lines) {
      if (first_line === 1 && !batch.length && line.includes("\u0000")) {
        return;
      }
      batch.push(line);
      if (batch.length < stream_batch_lines) {
        continue;
      }
      await collect(matcher, batch, first_line, file, matches, limit);
      if (matches.length >= limit || matcher.timed_out()) {
        return;
      }
      first_line += batch.length;
      batch = [];
    }
    await collect(matcher, batch, first_line, file, matches, limit);
  } finally {
    lines.close();
    stream.destroy();
  }
};

const grep_targets = async (project_root: string, scope: string, signal: AbortSignal) => {
  const scoped = await resolve_inside(project_root, scope || ".");
  const stat = await fs.stat(scoped.target);
  if (stat.isFile()) {
    if (is_secret_path(scoped.relative)) {
      throw new Error("Secret files are not readable by the agent");
    }
    return { root: scoped.root, files: [{ path: scoped.relative, size: stat.size }] };
  }
  if (!stat.isDirectory()) {
    throw new Error(`${scope} is not a file or directory`);
  }
  return { root: scoped.root, files: (await walk_project(scoped.root, scoped.target, signal)).files };
};

const search = async (project_root: string, query: GrepQuery, matcher: Matcher, signal: AbortSignal): Promise<GrepResult> => {
  const result: GrepResult = { mode: matcher.mode, regex_error: matcher.regex_error, matches: [], capped: false, timed_out: false, files_scanned: 0 };
  if (!query.query.trim()) {
    return result;
  }
  const targets = await grep_targets(project_root, query.path, signal);
  const limit = max_grep_matches + 1;
  for (const file of targets.files) {
    if (result.matches.length >= limit || matcher.timed_out()) {
      break;
    }
    signal.throwIfAborted();
    const absolute = path.join(targets.root, file.path);
    try {
      const scan = file.size > stream_threshold ? scan_stream : scan_small;
      await scan(absolute, file.path, matcher, result.matches, limit);
      result.files_scanned += 1;
    } catch (error) {
      if (signal.aborted || error instanceof RegexWorkerError) {
        throw error;
      }
      console.warn(`[project] grep could not read ${absolute}: ${error_text(error)}`);
    }
  }
  result.timed_out = matcher.timed_out();
  result.capped = result.matches.length > max_grep_matches;
  result.matches.length = Math.min(result.matches.length, max_grep_matches);
  return result;
};

export const grep_project = async (project_root: string, query: GrepQuery, signal: AbortSignal): Promise<GrepResult> => {
  const matcher = build_matcher(query, signal);
  try {
    return await search(project_root, query, matcher, signal);
  } finally {
    matcher.close();
  }
};

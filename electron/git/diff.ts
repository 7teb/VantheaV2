import type { GitEntry, GitFileDiff, GitRepoView, LineCount } from "../../shared/git-view.ts";
import { parse_unified_diff } from "../../shared/git/diff-parse.ts";
import { parse_numstat } from "../../shared/git/numstat-parse.ts";
import { decode_text } from "../storage/text-codec.ts";
import type { GitRef } from "./refs.ts";
import { exec_git, git_ok, type GitConfigPair, type GitTool } from "./run.ts";

export type GitReadAccess = { tool: GitTool; root: string; config: GitConfigPair[]; view: GitRepoView; refs: GitRef[]; signal: AbortSignal };

export const diff_flags = ["--no-ext-diff", "--no-textconv", "--no-color", "--submodule=short"];

export const no_index_refresh = ["-c", "diff.autoRefreshIndex=false"];

const content_statuses = new Set<GitEntry["status"]>(["modified", "type_changed"]);

const untracked_statuses = new Set<GitEntry["status"]>(["untracked", "ignored"]);

const changed_entry = (view: GitRepoView, path: string): GitEntry => {
  const matches = view.entries.filter((candidate) => candidate.path === path || candidate.orig_path === path);
  const entry = matches.find((candidate) => !untracked_statuses.has(candidate.status)) ?? matches[0];
  if (!entry) {
    throw new Error(`${path} is not a changed file in the git view of ${view.repo.root}`);
  }
  return entry;
};

export const missing_object = (stderr: string): boolean => /lazy fetching disabled|unable to read [0-9a-f]{7,}|missing (?:blob|tree) object/i.test(stderr);

const detect_flags = (entry: GitEntry): string[] => {
  if (entry.status === "renamed") return ["-M"];
  if (entry.status === "copied") return ["-C", "-C"];
  return [];
};

export const classify_diff = (text: string, empty: GitFileDiff): GitFileDiff => {
  if (text.trim() === "") {
    return empty;
  }
  const parsed = parse_unified_diff(text);
  if (parsed.binary) return { kind: "binary" };
  if (parsed.lines.length === 0) return { kind: "unchanged" };
  return { kind: "text", lines: parsed.lines };
};

export const read_file_diff = async (access: GitReadAccess, path: string): Promise<GitFileDiff> => {
  const entry = changed_entry(access.view, path);
  if (entry.status === "conflicted") {
    return { kind: "conflict" };
  }
  if (untracked_statuses.has(entry.status)) {
    throw new Error(`${entry.path} is not tracked by git and has no diff`);
  }
  if (access.view.head === null) {
    throw new Error(`${access.view.repo.root} has no commits yet, ${entry.path} has no diff against HEAD`);
  }
  const paths = entry.orig_path === null ? [entry.path] : [entry.orig_path, entry.path];
  const args = ["diff", "HEAD", ...diff_flags, ...detect_flags(entry), "-U3", "--", ...paths];
  const output = await exec_git(access.tool, { cwd: access.root, args, flags: no_index_refresh, config: access.config, literal_paths: true, signal: access.signal });
  if (output.code !== 0 && missing_object(output.stderr)) {
    return { kind: "object_missing" };
  }
  const stdout = git_ok(output, `git diff HEAD -- ${paths.join(" ")} in ${access.root}`);
  return classify_diff(decode_text(stdout).text, content_statuses.has(entry.status) ? { kind: "eol_only" } : { kind: "unchanged" });
};

export const read_line_counts = async (access: GitReadAccess): Promise<LineCount[]> => {
  const base = access.view.head === null ? ["diff", "--cached", "--numstat", "-z", "--relative"] : ["diff", "HEAD", "--numstat", "-z", "-M", "--relative"];
  const output = await exec_git(access.tool, { cwd: access.root, args: [...base, ...diff_flags, "--", "."], flags: no_index_refresh, config: access.config, signal: access.signal });
  const records = parse_numstat(git_ok(output, `git diff --numstat in ${access.root}`).toString("utf8"));
  return records.map((record) => ({ path: record.path, added: record.added, removed: record.removed }));
};

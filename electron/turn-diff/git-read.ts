import type { GitFileDiff } from "../../shared/git-view.ts";
import { parse_numstat, parse_raw, type NumstatRecord, type RawRecord } from "../../shared/git/numstat-parse.ts";
import type { DiffEntry, DiffStatus } from "../../shared/turn-diff.ts";
import { classify_diff, diff_flags, missing_object } from "../git/diff.ts";
import { fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok, type GitOutput } from "../git/run.ts";
import { decode_text } from "../storage/text-codec.ts";
import { snapshot_env } from "./git-snapshot.ts";
import type { GitTarget } from "./git-target.ts";
import type { ChatPaths } from "./paths.ts";

export type PairSummary = { entries: DiffEntry[]; renames_skipped: boolean };

export type TreePair = { prefix: string; base: string; end: string };

const status_letters: Record<string, DiffStatus> = { A: "added", M: "modified", D: "deleted", R: "renamed", T: "type_changed" };

const gitlink_mode = "160000";

const commit_of = (oid: string): string | null => (/^0+$/.test(oid) ? null : oid);

const by_path = (left: DiffEntry, right: DiffEntry): number => {
  const a = left.path.toLowerCase();
  const b = right.path.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
};

export const sort_entries = (entries: DiffEntry[]): DiffEntry[] => entries.sort(by_path);

const entry_of = (record: RawRecord, counts: NumstatRecord | undefined): DiffEntry => {
  if (record.old_mode === gitlink_mode || record.new_mode === gitlink_mode) {
    return { path: record.path, orig_path: record.orig_path, status: "submodule", added: null, removed: null, binary: false, commits: { from: commit_of(record.old_oid), to: commit_of(record.new_oid) } };
  }
  const added = counts?.added ?? null;
  const removed = counts?.removed ?? null;
  return {
    path: record.path,
    orig_path: record.orig_path,
    status: status_letters[record.status] ?? "modified",
    added,
    removed,
    binary: counts !== undefined && added === null && removed === null,
    commits: null,
  };
};

const relative_flags = (prefix: string): string[] => (prefix === "" ? [] : [`--relative=${prefix}`]);

const read_git = (target: GitTarget, paths: ChatPaths, args: string[], signal: AbortSignal, literal_paths = false): Promise<GitOutput> =>
  exec_git(target.tool, {
    cwd: target.paths.top,
    args,
    flags: fsmonitor_off,
    config: target.config,
    literal_paths,
    env: snapshot_env(paths, target.paths.common_dir, false),
    signal,
  });

export const read_pair = async (target: GitTarget, paths: ChatPaths, pair: TreePair, signal: AbortSignal): Promise<PairSummary> => {
  const args = ["diff-tree", "-r", "-z", "-M", "--no-abbrev", "--raw", "--numstat", ...relative_flags(pair.prefix), ...diff_flags, pair.base, pair.end];
  const output = await read_git(target, paths, args, signal);
  const text = git_ok(output, `git diff-tree ${pair.base} ${pair.end} in ${target.paths.top}`).toString("utf8");
  const counts = new Map(parse_numstat(text).map((record) => [record.path, record]));
  const entries = parse_raw(text).map((record) => entry_of(record, counts.get(record.path)));
  return { entries: sort_entries(entries), renames_skipped: /rename detection was skipped/i.test(output.stderr) };
};

export const read_pair_file = async (target: GitTarget, paths: ChatPaths, pair: TreePair, entry: DiffEntry, signal: AbortSignal): Promise<GitFileDiff> => {
  const files = (entry.orig_path === null ? [entry.path] : [entry.orig_path, entry.path]).map((file) => `${pair.prefix}${file}`);
  const args = ["diff-tree", "-p", "-r", "-M", "-U3", ...relative_flags(pair.prefix), ...diff_flags, pair.base, pair.end, "--", ...files];
  const output = await read_git(target, paths, args, signal, true);
  if (output.code !== 0 && missing_object(output.stderr)) return { kind: "object_missing" };
  const stdout = git_ok(output, `git diff-tree ${pair.base} ${pair.end} -- ${files.join(" ")} in ${target.paths.top}`);
  return classify_diff(decode_text(stdout).text, { kind: "unchanged" });
};

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { error_code, missing_path } from "../storage/coerce.ts";
import { exec_git, git_ok, type GitConfigPair, type GitTool } from "./run.ts";

export type GitRef = {
  name: string;
  kind: "branch" | "remote" | "tag";
  hash: string;
  target: string;
  upstream: string | null;
  track: string | null;
  head: boolean;
  worktree: string | null;
};

export type FetchHead = { mtime_ms: number; text: string };

export type RefsRead = { raw: Buffer; refs: GitRef[]; fetch_head: FetchHead | null };

const refs_args = [
  "for-each-ref",
  "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(HEAD)%00%(worktreepath)",
  "refs/heads",
  "refs/remotes",
  "refs/tags",
];

const ref_kinds: [prefix: string, kind: GitRef["kind"]][] = [
  ["refs/heads/", "branch"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
];

const short_upstream = (value: string): string | null => value.replace(/^refs\/(?:heads|remotes)\//, "") || null;

export const parse_refs = (text: string): GitRef[] =>
  text.split("\n").flatMap((line): GitRef[] => {
    const [refname = "", hash = "", peeled = "", upstream = "", track = "", head = "", worktree = ""] = line.replace(/\r$/, "").split("\0");
    const match = ref_kinds.find(([prefix]) => refname.startsWith(prefix));
    if (!match || !hash) return [];
    const [prefix, kind] = match;
    const name = refname.slice(prefix.length);
    if (kind === "remote" && name.endsWith("/HEAD")) return [];
    return [{ name, kind, hash, target: peeled || hash, upstream: short_upstream(upstream), track: track || null, head: head === "*", worktree: worktree || null }];
  });

export const refs_fingerprint = (raw: Buffer, oid: string | null): string => createHash("sha1").update(raw).update("\0").update(oid ?? "").digest("hex");

const read_fetch_head = async (git_dir: string): Promise<FetchHead | null> => {
  const file = path.join(git_dir, "FETCH_HEAD");
  try {
    const [info, text] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
    return { mtime_ms: info.mtimeMs, text };
  } catch (error) {
    if (!missing_path(error)) console.warn(`[git] reading ${file} for the last fetch failed: ${error_code(error) || String(error)}`);
    return null;
  }
};

export const read_refs = async (tool: GitTool, root: string, git_dir: string, config: GitConfigPair[], signal?: AbortSignal): Promise<RefsRead> => {
  const [output, fetch_head] = await Promise.all([exec_git(tool, { cwd: root, args: refs_args, config, signal }), read_fetch_head(git_dir)]);
  const raw = git_ok(output, `git for-each-ref in ${root}`);
  return { raw, refs: parse_refs(raw.toString("utf8")), fetch_head };
};

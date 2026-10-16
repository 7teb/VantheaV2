import type { CommitDetail, CommitFile, GitFileDiff } from "../../shared/git-view.ts";
import { parse_numstat, parse_raw } from "../../shared/git/numstat-parse.ts";
import { decode_text } from "../storage/text-codec.ts";
import { classify_diff, diff_flags, missing_object, type GitReadAccess } from "./diff.ts";
import { commit_time } from "./history.ts";
import { exec_git, git_ok } from "./run.ts";

type CommitHead = Omit<CommitDetail, "files" | "counted">;

type CommitFiles = Pick<CommitDetail, "files" | "counted">;

type KnownCommit = CommitFiles & { head: CommitHead };

type ListedFile = Omit<CommitFile, "added" | "removed">;

export type CommitReader = {
  detail: (access: GitReadAccess, hash: string) => Promise<CommitDetail>;
  file_diff: (access: GitReadAccess, hash: string, path: string) => Promise<GitFileDiff>;
};

const file_statuses: Record<string, CommitFile["status"]> = { M: "modified", A: "added", D: "deleted", R: "renamed", T: "type_changed" };

export const parse_commit_head = (text: string): CommitHead => {
  const [hash = "", parents = "", author = "", email = "", time = "", ...message] = text.split("\0");
  if (!/^[0-9a-f]{40,64}$/.test(hash)) {
    throw new Error(`git rev-list printed no commit record: ${JSON.stringify(text.slice(0, 120))}`);
  }
  return { hash, parents: parents === "" ? [] : parents.split(" "), author, email, time: commit_time(time), message: message.join("\0").trimEnd() };
};

const tree_pair = (head: CommitHead): string[] => (head.parents.length === 0 ? ["--root", head.hash] : [head.parents[0], head.hash]);

const read_head = async (access: GitReadAccess, hash: string): Promise<CommitHead> => {
  const args = ["rev-list", "--no-commit-header", "--encoding=UTF-8", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%B", "--max-count=1", hash, "--"];
  const output = await exec_git(access.tool, { cwd: access.root, args, config: access.config, signal: access.signal });
  return parse_commit_head(git_ok(output, `git rev-list ${hash} in ${access.root}`).toString("utf8"));
};

const listed_files = (text: string, hash: string): ListedFile[] =>
  parse_raw(text).flatMap((record): ListedFile[] => {
    const status = file_statuses[record.status];
    if (status) return [{ status, path: record.path, orig_path: record.orig_path }];
    console.warn(`[git] commit ${hash} lists ${record.path} with the unexpected status ${record.status}, the file is left out`);
    return [];
  });

export const commit_files = (text: string, hash: string): CommitFile[] => {
  const counts = new Map(parse_numstat(text).map((record) => [`${record.orig_path ?? ""}\0${record.path}`, record]));
  return listed_files(text, hash).map((file) => {
    const count = counts.get(`${file.orig_path ?? ""}\0${file.path}`);
    if (!count) {
      throw new Error(`git diff-tree for commit ${hash} printed no line counts for ${file.path}`);
    }
    return { ...file, added: count.added, removed: count.removed };
  });
};

const read_files = async (access: GitReadAccess, head: CommitHead): Promise<CommitFiles> => {
  const top = access.view.repo.root;
  const diff_tree = (args: string[]) =>
    exec_git(access.tool, { cwd: top, args: ["diff-tree", "--no-commit-id", "-r", "-z", ...args, ...diff_flags, ...tree_pair(head)], config: access.config, signal: access.signal });
  const counted = await diff_tree(["-M", "--raw", "--numstat"]);
  if (counted.code === 0 || !missing_object(counted.stderr)) {
    return { files: commit_files(git_ok(counted, `git diff-tree ${head.hash} in ${top}`).toString("utf8"), head.hash), counted: true };
  }
  const listed = await diff_tree(["--no-renames", "--raw"]);
  const text = git_ok(listed, `git diff-tree --no-renames ${head.hash} in ${top}`).toString("utf8");
  return { files: listed_files(text, head.hash).map((file) => ({ ...file, added: null, removed: null })), counted: false };
};

const read_file_diff = async (access: GitReadAccess, head: CommitHead, file: CommitFile): Promise<GitFileDiff> => {
  const top = access.view.repo.root;
  const paths = file.orig_path === null ? [file.path] : [file.orig_path, file.path];
  const args = ["diff-tree", "-p", "--no-commit-id", "-r", "-M", "-U3", ...diff_flags, ...tree_pair(head), "--", ...paths];
  const output = await exec_git(access.tool, { cwd: top, args, config: access.config, literal_paths: true, signal: access.signal });
  if (output.code !== 0 && missing_object(output.stderr)) {
    return { kind: "object_missing" };
  }
  const stdout = git_ok(output, `git diff-tree -p ${head.hash} -- ${paths.join(" ")} in ${top}`);
  return classify_diff(decode_text(stdout).text, { kind: "unchanged" });
};

export const create_commit_reader = (): CommitReader => {
  const known = new Map<string, KnownCommit>();

  const load = async (access: GitReadAccess, hash: string): Promise<KnownCommit> => {
    const cached = known.get(hash);
    if (cached) return cached;
    const head = await read_head(access, hash);
    const same = known.get(head.hash);
    if (same) return same;
    const commit = { head, ...(await read_files(access, head)) };
    known.set(head.hash, commit);
    return commit;
  };

  return {
    detail: async (access, hash) => {
      const { head, files, counted } = await load(access, hash);
      return { ...head, files, counted };
    },
    file_diff: async (access, hash, path) => {
      const { head, files } = await load(access, hash);
      const file = files.find((entry) => entry.path === path || entry.orig_path === path);
      if (!file) {
        throw new Error(`${path} is not a file of commit ${head.hash}`);
      }
      return read_file_diff(access, head, file);
    },
  };
};

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommitResult } from "../../shared/ipc/git-actions.ts";
import { strip_userinfo } from "../../shared/git/remote-url.ts";
import { is_secret_path } from "../../shared/secret-path.ts";
import { error_text } from "../storage/coerce.ts";
import type { GitReadAccess } from "./diff.ts";
import { error_line, exec_git, git_ok, write_hooks, type GitOutput } from "./run.ts";
import type { RepoWriteGuard } from "./write-guard.ts";

type Run = (args: string[], options?: { literal?: boolean; hooks?: boolean }) => Promise<GitOutput>;

const commit_patterns: [RegExp, "identity" | "nothing" | "locked"][] = [
  [/Please tell me who you are|Author identity unknown|empty ident name|unable to auto-detect email address/i, "identity"],
  [/nothing to commit|nothing added to commit|no changes added to commit/i, "nothing"],
  [/index\.lock/i, "locked"],
];

export const classify_commit = (output: string): "identity" | "nothing" | "locked" | null => commit_patterns.find(([pattern]) => pattern.test(output))?.[1] ?? null;

const output_text = (output: GitOutput): string =>
  `${output.stderr}\n${output.stdout.toString("utf8")}`
    .split(/\r?\n/)
    .map((line) => strip_userinfo(line.trimEnd()))
    .filter((line) => line.trim() !== "")
    .join("\n");

const write_pathspec = async (paths: string[]): Promise<string> => {
  const file = path.join(os.tmpdir(), `vx-pathspec-${randomBytes(8).toString("hex")}.txt`);
  await fs.writeFile(file, `${paths.join("\0")}\0`, "utf8");
  return file;
};

const unstage = async (run: Run, list: string, root: string) => {
  try {
    git_ok(await run(["rm", "--cached", "-q", "-f", "--ignore-unmatch", `--pathspec-from-file=${list}`, "--pathspec-file-nul"], { literal: true }), "git rm --cached");
  } catch (error) {
    console.error(`[git] taking the new files listed in ${list} out of the index of ${root} again after a failed commit failed:`, error);
  }
};

const drop_file = async (file: string) => {
  try {
    await fs.rm(file, { force: true });
  } catch (error) {
    console.warn(`[git] removing the pathspec file ${file} failed: ${error_text(error)}`);
  }
};

export const commit_changes = async (access: GitReadAccess, guard: RepoWriteGuard, message: string, hooks = write_hooks): Promise<CommitResult> => {
  const { view, root } = access;
  if (view.operation) return { kind: "blocked", reason: "operation" };
  if (view.entries.some((entry) => entry.status === "conflicted")) return { kind: "blocked", reason: "conflicts" };
  if (guard.commit_block.length > 0) return { kind: "programs", keys: guard.commit_block };
  const list_paths = async (args: string[], what: string): Promise<string[]> =>
    git_ok(await exec_git(access.tool, { cwd: root, args, config: access.config, signal: access.signal }), what).toString("utf8").split("\0").filter(Boolean);
  const run: Run = (args, options = {}) => exec_git(access.tool, { cwd: root, args, config: access.config, literal_paths: options.literal, hooks: options.hooks });
  const others = await list_paths(["ls-files", "-z", "--others", "--exclude-standard", "--", "."], `git ls-files --others in ${root}`);
  const staged_new = await list_paths(["diff", "--cached", "--ita-visible-in-index", "--name-only", "--diff-filter=A", "--no-renames", "--relative", "-z", "--", "."], `git diff --cached in ${root}`);
  const staged_secrets = staged_new.filter((name) => is_secret_path(name));
  const left_out = [...others.filter((name) => name.endsWith("/") || is_secret_path(name)), ...staged_secrets];
  const added = others.filter((name) => !left_out.includes(name));
  const list = added.length > 0 ? await write_pathspec(added) : null;
  let committed = false;
  try {
    if (list) git_ok(await run(["add", `--pathspec-from-file=${list}`, "--pathspec-file-nul"], { literal: true }), `git add of ${added.length} new files in ${root}`);
    const output = await run(["commit", "--cleanup=whitespace", "--quiet", "-m", message, "--", ".", ...staged_secrets.map((name) => `:(exclude,literal)${name}`)], { hooks });
    if (output.code === 0) {
      committed = true;
      return { kind: "done", hash: git_ok(await run(["rev-parse", "HEAD"]), `git rev-parse HEAD in ${root}`).toString("utf8").trim(), left_out };
    }
    const text = output_text(output);
    const kind = classify_commit(text);
    if (kind === "nothing") return { kind, left_out };
    if (kind) return { kind };
    if (hooks && guard.hooks) return { kind: "hook", output: text };
    return { kind: "failed", error: error_line(output.stderr) || text.split("\n")[0] || `git commit exited with ${output.code}` };
  } finally {
    if (list && !committed) await unstage(run, list, root);
    if (list) await drop_file(list);
  }
};

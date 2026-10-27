import type { ChatMeta, ChatWorktree } from "../../shared/chat.ts";
import type { WorktreeTarget, WorktreeWork } from "../../shared/ipc/worktrees.ts";
import { list_chats } from "../chats/store.ts";
import { read_guard } from "../git/guard.ts";
import { require_git_tool } from "../git/locate.ts";
import { detect_repo, entry_kind, fsmonitor_off } from "../git/repo.ts";
import { exec_git, git_ok, type GitTool } from "../git/run.ts";
import { follow_project } from "../project/follow.ts";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { worktree_head } from "./head.ts";

type WorktreeChat = ChatMeta & { worktree: ChatWorktree };

export const count_status = (raw: string): number => {
  const records = raw.split("\0");
  let count = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (!record) continue;
    count += 1;
    if (/^[RC]|^.[RC]/.test(record)) index += 1;
  }
  return count;
};

const count_unpushed = async (tool: GitTool, cwd: string, base: string, tip: string): Promise<number> => {
  const output = await exec_git(tool, { cwd, args: ["rev-list", "--count", `${base}..${tip}`, "--not", "--remotes"], flags: fsmonitor_off });
  return Number(git_ok(output, `git rev-list --count ${base}..${tip} in ${cwd}`).toString("utf8").trim());
};

const missing_work = async (tool: GitTool, meta: WorktreeChat): Promise<{ changed: number; unpushed: number }> => {
  const main_dir = await follow_project(meta.project_path);
  if ((await entry_kind(main_dir)) !== "dir") {
    return { changed: 0, unpushed: 0 };
  }
  const ref = `refs/heads/${meta.worktree.branch}`;
  const exists = await exec_git(tool, { cwd: main_dir, args: ["rev-parse", "--verify", "--quiet", ref], flags: fsmonitor_off });
  return { changed: 0, unpushed: exists.code === 0 ? await count_unpushed(tool, main_dir, meta.worktree.base, ref) : 0 };
};

const present_work = async (tool: GitTool, worktree: ChatWorktree): Promise<{ changed: number; unpushed: number }> => {
  const detected = await detect_repo(tool, worktree.path);
  if (detected.kind !== "repo") {
    throw new Error(`the worktree ${worktree.path} is not a readable Git checkout (${detected.kind})`);
  }
  const guard = await read_guard(tool, detected.paths, null);
  const status = await exec_git(tool, { cwd: worktree.path, args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"], config: guard.read_config, flags: fsmonitor_off });
  const changed = count_status(git_ok(status, `git status in ${worktree.path}`).toString("utf8"));
  return { changed, unpushed: await count_unpushed(tool, worktree.path, worktree.base, "HEAD") };
};

export const worktree_work = async (meta: WorktreeChat, others: ChatMeta[]): Promise<WorktreeWork> => {
  const { worktree } = meta;
  const tool = await require_git_tool();
  const head = await worktree_head(worktree);
  const counts = head.missing ? await missing_work(tool, meta) : await present_work(tool, worktree);
  const shared = others.some((other) => other.id !== meta.id && other.worktree !== undefined && path_key(other.worktree.path) === path_key(worktree.path));
  return { chat_id: meta.id, title: meta.title, branch: head.branch ?? worktree.branch, ...counts, missing: head.missing, shared };
};

const in_target = (target: WorktreeTarget) => {
  switch (target.kind) {
    case "chats": {
      const ids = new Set(target.chat_ids);
      return (meta: ChatMeta) => ids.has(meta.id);
    }
    case "project": {
      const key = path_key(target.project_path);
      return (meta: ChatMeta) => path_key(meta.project_path) === key;
    }
    case "projects":
      return (meta: ChatMeta) => meta.project_path !== "";
    case "all":
      return () => true;
  }
};

export const target_work = async (target: WorktreeTarget): Promise<WorktreeWork[]> => {
  const chats = list_chats();
  const wanted = in_target(target);
  const others = chats.filter((meta) => !wanted(meta));
  const seen = new Set<string>();
  const work: WorktreeWork[] = [];
  for (const meta of chats) {
    if (!wanted(meta) || !meta.worktree || seen.has(path_key(meta.worktree.path))) continue;
    seen.add(path_key(meta.worktree.path));
    try {
      work.push(await worktree_work({ ...meta, worktree: meta.worktree }, others));
    } catch (error) {
      throw new Error(`reading the work in the worktree ${meta.worktree.path} of chat ${meta.id} failed: ${error_text(error)}`, { cause: error });
    }
  }
  return work;
};

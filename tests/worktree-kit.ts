import fs from "node:fs/promises";
import path from "node:path";
import { after } from "node:test";
import { flush_all_sync } from "../electron/chats/store.ts";
import { read_folder_id } from "../electron/project/folder.ts";
import { add_project, init_settings } from "../electron/settings/store.ts";
import { set_storage_root, storage_paths } from "../electron/storage/paths.ts";
import { boot_chats, make_root } from "./fixtures/legacy/harness.ts";
import { git, repo_with } from "./git-kit.ts";

export type WorktreeEnv = { root: string; worktrees: string };

let env: WorktreeEnv | null = null;

after(async () => {
  flush_all_sync();
  if (env) await fs.rm(env.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

export const worktree_env = async (): Promise<WorktreeEnv> => {
  if (env) return env;
  const root = await fs.realpath(await make_root("vx-worktree-"));
  set_storage_root(root);
  await fs.mkdir(storage_paths().worktrees, { recursive: true });
  await boot_chats(root);
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
  env = { root, worktrees: storage_paths().worktrees };
  return env;
};

export const listed_project = async (dir: string): Promise<string> => {
  await add_project(dir, await read_folder_id(dir));
  return dir;
};

export const project_repo = async (prefix: string, files: Record<string, string> = {}): Promise<string> =>
  listed_project(await repo_with(prefix, { "README.md": "readme\n", ".gitignore": "node_modules/\n.env*\n", ...files }));

export const commit_all = (dir: string, message: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
};

export const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

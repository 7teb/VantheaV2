import fs from "node:fs/promises";
import path from "node:path";
import type { GitRepoView } from "../shared/git-view.ts";
import type { GitReadAccess } from "../electron/git/diff.ts";
import { read_guard } from "../electron/git/guard.ts";
import { detect_repo } from "../electron/git/repo.ts";
import { read_write_guard, type RepoWriteGuard } from "../electron/git/write-guard.ts";
import { first_view, scratch, tool } from "./git-kit.ts";

export const identity_config = async (identity = true): Promise<string> => {
  const dir = await scratch("write-config");
  const global = path.join(dir, "global.gitconfig");
  const lines = identity ? ["[user]", "\tname = VantheaX Test", "\temail = test@example.invalid"] : ["[user]", "\tuseConfigOnly = true"];
  await fs.writeFile(global, [...lines, "[commit]", "\tgpgsign = false", "[init]", "\tdefaultBranch = main", ""].join("\n"));
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = global;
  return global;
};

export const repo_view = async (root: string): Promise<GitRepoView> => {
  const view = await first_view(root);
  if (view.kind !== "repo") throw new Error(`${root} shows no repository: ${JSON.stringify(view)}`);
  return view;
};

export const access_of = async (root: string): Promise<GitReadAccess> => {
  const detected = await detect_repo(tool(), root);
  if (detected.kind !== "repo") throw new Error(`${root} is not a repository`);
  const guard = await read_guard(tool(), detected.paths, null);
  return { tool: tool(), root, config: guard.read_config, view: await repo_view(root), refs: [], signal: new AbortController().signal };
};

export const write_guard_of = (root: string): Promise<RepoWriteGuard> => read_write_guard(tool(), root);

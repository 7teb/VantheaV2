import fs from "node:fs/promises";
import path from "node:path";
import { create_repo_busy, type RepoBusy } from "../electron/git/busy.ts";
import { create_fetcher, type Fetcher, type FetchTarget } from "../electron/git/fetch.ts";
import { read_guard } from "../electron/git/guard.ts";
import { read_remotes } from "../electron/git/remotes.ts";
import { detect_repo } from "../electron/git/repo.ts";
import { git, repo_with, scratch, tool } from "./git-kit.ts";

export type Work = { turns: string[]; agents: string[]; tasks: string[] };

export type FetchRig = { fetcher: Fetcher; busy: RepoBusy; work: Work };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const wait_for = async (what: string, done: () => boolean, limit_ms = 20_000) => {
  for (let waited = 0; !done(); waited += 25) {
    if (waited > limit_ms) throw new Error(`${what} did not happen within ${limit_ms} ms`);
    await sleep(25);
  }
};

export const isolated_config = async () => {
  const dir = await scratch("fetch-config");
  const global = path.join(dir, "global.gitconfig");
  await fs.writeFile(global, "");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = global;
};

export type HeldBusy = { busy: RepoBusy; checks: () => number; release: (in_use: boolean) => Promise<void> };

export const held_busy = (): HeldBusy => {
  const waiting: ((in_use: boolean) => void)[] = [];
  const listeners = new Set<() => void>();
  let asked = 0;
  const busy: RepoBusy = {
    in_use: () =>
      new Promise((resolve) => {
        asked += 1;
        waiting.push(resolve);
      }),
    checkout_in_use: async () => false,
    changed: () => {
      for (const listener of listeners) listener();
    },
    on_change: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const release = async (in_use: boolean) => {
    await wait_for("a busy check", () => waiting.length > 0);
    waiting.shift()?.(in_use);
    await sleep(0);
  };
  return { busy, checks: () => asked, release };
};

export const fetch_rig = (): FetchRig => {
  const work: Work = { turns: [], agents: [], tasks: [] };
  const busy = create_repo_busy({ turn_chats: () => [...work.turns], chat_root: async (chat_id) => chat_id, agent_roots: () => work.agents, background_roots: () => work.tasks });
  return { fetcher: create_fetcher(busy), busy, work };
};

export const target_of = async (root: string, remote_name = "origin"): Promise<FetchTarget> => {
  const detected = await detect_repo(tool(), root);
  if (detected.kind !== "repo") throw new Error(`${root} is not a repository: ${JSON.stringify(detected)}`);
  const guard = await read_guard(tool(), detected.paths, null);
  const remote = (await read_remotes(tool(), root, guard.read_config)).remotes.find((entry) => entry.name === remote_name);
  if (!remote) throw new Error(`${root} has no remote ${remote_name}`);
  return { tool: tool(), top: detected.paths.top, common_dir: detected.paths.common_dir, remote, guard, fetch_head_at: null };
};

export const ref_of = (root: string, ref: string): string => git(root, "rev-parse", ref).trim();

export const cloned_pair = async (prefix: string) => {
  const source = await repo_with(`${prefix}-src`, { "a.txt": "a\n" });
  const bare = `${await scratch(`${prefix}-bare`)}/r.git`;
  git(source, "clone", "-q", "--bare", source, bare);
  git(source, "remote", "add", "origin", bare);
  git(source, "fetch", "-q", "origin");
  const local = `${await scratch(`${prefix}-local`)}/work`;
  git(source, "clone", "-q", bare, local);
  const push = async (file: string) => {
    git(source, "commit", "-q", "--allow-empty", "-m", file);
    git(source, "push", "-q", "origin", "HEAD:main");
    return ref_of(source, "HEAD");
  };
  return { source, bare, local, push };
};

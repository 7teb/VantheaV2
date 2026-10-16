import fs from "node:fs/promises";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { git_location } from "./repo.ts";

export type WorkSources = {
  turn_chats: () => string[];
  chat_root: (chat_id: string) => Promise<string | null>;
  agent_roots: () => string[];
  background_roots: () => string[];
};

export type RepoBusy = {
  in_use: (common_dir: string) => Promise<boolean>;
  changed: () => void;
  on_change: (listener: () => void) => () => void;
};

const real_path = async (dir: string): Promise<string> => {
  try {
    return await fs.realpath(dir);
  } catch (error) {
    console.warn(`[git] resolving the real path of ${dir} failed: ${error_text(error)}`);
    return path.resolve(dir);
  }
};

export const create_repo_busy = (sources: WorkSources): RepoBusy => {
  const known = new Map<string, string>();
  const listeners = new Set<() => void>();
  let signature = "";
  let settling = false;

  const common_of = async (dir: string): Promise<string | null> => {
    const key = path_key(dir);
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const location = await git_location(await real_path(dir));
    if (!location) return null;
    const common = path_key(await real_path(location.common_dir));
    known.set(key, common);
    return common;
  };

  const turn_roots = async (): Promise<string[]> => {
    const roots = await Promise.all(sources.turn_chats().map(sources.chat_root));
    return roots.filter((root) => root !== null);
  };

  const work_signature = (): string => {
    const keys = (roots: string[]) => roots.map(path_key).sort();
    return JSON.stringify([sources.turn_chats().sort(), keys(sources.agent_roots()), keys(sources.background_roots())]);
  };

  return {
    in_use: async (common_dir) => {
      const roots = [...(await turn_roots()), ...sources.agent_roots(), ...sources.background_roots()];
      const [wanted, commons] = await Promise.all([real_path(common_dir), Promise.all([...new Set(roots)].map(common_of))]);
      return commons.includes(path_key(wanted));
    },
    changed: () => {
      if (settling) return;
      settling = true;
      queueMicrotask(() => {
        settling = false;
        try {
          const next = work_signature();
          if (next === signature) return;
          signature = next;
        } catch (error) {
          console.error("[git] reading where agents, turns and background tasks work failed:", error);
          return;
        }
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            console.error("[git] a listener for a change of agent work failed:", error);
          }
        }
      });
    },
    on_change: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

import fs from "node:fs/promises";
import { fork } from "./fork.ts";
import * as queue from "./queue.ts";
import { listen, mark_shutting_down, set_deps, type TurnDiffDeps } from "./state.ts";
import { file, summaries } from "./summary.ts";
import { remove_chat, sweep_orphans } from "./sweep.ts";
import { before_write, begin, end, ready, work_ended } from "./turns.ts";

const shutdown = (): void => {
  if (!mark_shutting_down()) return;
  queue.stop_all("the app is closing");
};

export const turn_diffs = { begin, ready, end, before_write, work_ended, summaries, file, fork, remove_chat, listen, shutdown };

export const init_turn_diffs = async (deps: TurnDiffDeps): Promise<void> => {
  await fs.mkdir(deps.root, { recursive: true });
  set_deps(deps);
  sweep_orphans().catch((error) => console.error(`[turn-diff] sweeping the snapshot folders of deleted chats in ${deps.root} failed:`, error));
};

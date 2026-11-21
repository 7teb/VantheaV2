import type { ChatActivity } from "../../shared/api/contract.ts";
import { live_runs } from "../agents/live.ts";
import { has_due_agent_notes } from "../agents/reports.ts";
import { list_background } from "../background/manager.ts";
import { add_event_tap } from "../ipc/handle.ts";
import { is_active, on_active_turns_changed } from "../turn/active.ts";
import { live_workflows } from "../workflows/live.ts";
import { pending_event_count } from "./notifications.ts";

const live_agents_of = (chat_id: string) => live_runs().filter((live) => live.chat_id === chat_id);

const live_workflows_of = (chat_id: string) => live_workflows().filter((run) => run.context.chat_id === chat_id);

export const chat_activity = (chat_id: string): ChatActivity => ({
  turn: is_active(chat_id),
  agents: live_agents_of(chat_id).length,
  workflows: live_workflows_of(chat_id).length,
  background: list_background(chat_id).filter((task) => task.status === "running").length,
  queued: pending_event_count(chat_id) + (has_due_agent_notes(chat_id) ? 1 : 0),
});

export const chat_idle = (chat_id: string): boolean => {
  if (is_active(chat_id)) {
    return false;
  }
  const activity = chat_activity(chat_id);
  return activity.agents + activity.workflows + activity.background + activity.queued === 0;
};

export const when_idle = async (chat_id: string, signal: AbortSignal): Promise<void> => {
  let wake: (() => void) | null = null;
  const poke = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  const watched = new Set<Promise<void>>();
  const watch_done = () => {
    for (const done of [...live_agents_of(chat_id), ...live_workflows_of(chat_id)].map((work) => work.done)) {
      if (watched.has(done)) {
        continue;
      }
      watched.add(done);
      done.then(poke, (error: unknown) => {
        console.error(`[idle] waiting for agent or workflow work in chat ${chat_id} to end failed:`, error);
        poke();
      });
    }
  };
  const remove_tap = add_event_tap(poke);
  const remove_turns = on_active_turns_changed(poke);
  signal.addEventListener("abort", poke);
  try {
    for (;;) {
      signal.throwIfAborted();
      if (chat_idle(chat_id)) {
        return;
      }
      watch_done();
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    remove_tap();
    remove_turns();
    signal.removeEventListener("abort", poke);
    wake = null;
  }
};

import { powerMonitor } from "electron";
import { live_run, on_agent_event } from "../agents/live.ts";
import { chat_held } from "../app/notifications.ts";
import { emit } from "../ipc/handle.ts";
import { error_text } from "../storage/coerce.ts";
import { storage_paths } from "../storage/paths.ts";
import { is_active } from "../turn/active.ts";
import { notify_run_waiting, run_scheduled_task } from "./run.ts";
import { poke_scheduler, start_scheduler, stop_scheduler } from "./scheduler.ts";
import { load_scheduled, on_scheduled_changed, patch_task, scheduled_tasks, scheduled_views } from "./store.ts";

let unsubscribe: (() => void)[] = [];

let started = false;

export const load_scheduled_tasks = (): Promise<void> => load_scheduled(storage_paths().scheduled);

export const start_scheduled_tasks = (tools_ready: Promise<void>): void => {
  started = true;
  unsubscribe = [
    on_scheduled_changed(() => {
      emit("scheduled:changed", scheduled_views());
      poke_scheduler();
    }),
    on_agent_event((event) => {
      if (event.type !== "tool_approval") {
        return;
      }
      const live = live_run(event.run_id);
      if (live) {
        notify_run_waiting(live.chat_id, `${event.run_id}:${event.call_id}`);
      }
    }),
  ];
  powerMonitor.on("resume", poke_scheduler);
  powerMonitor.on("unlock-screen", poke_scheduler);
  tools_ready
    .then(() => {
      if (!started) {
        return;
      }
      start_scheduler({
        tasks: scheduled_tasks,
        busy: (task) => is_active(task.chat_id) || chat_held(task.chat_id),
        advance: (task_id, next_run_at) => {
          patch_task(task_id, (task) => ({ ...task, next_run_at }));
        },
        run: (task) => run_scheduled_task(task.id),
      });
    })
    .catch((error: unknown) => console.error(`[scheduled] starting the scheduler after the MCP servers settled failed: ${error_text(error)}`));
};

export const stop_scheduled_tasks = (): void => {
  started = false;
  stop_scheduler();
  powerMonitor.off("resume", poke_scheduler);
  powerMonitor.off("unlock-screen", poke_scheduler);
  for (const stop of unsubscribe) {
    stop();
  }
  unsubscribe = [];
};

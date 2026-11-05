import type { ScheduledInput, ScheduledTaskView } from "../../shared/scheduled.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import type { Loaded } from "./extensions.ts";
import { open_chat } from "./ui.ts";

export const scheduled_store = create_store<Loaded<ScheduledTaskView>>({ status: "loading", items: [] });

const ready = (items: ScheduledTaskView[]): Loaded<ScheduledTaskView> => ({ status: "ready", items });

export const load_scheduled = async () => {
  if (scheduled_store.get().status !== "ready") {
    scheduled_store.set({ status: "loading", items: [] });
  }
  try {
    scheduled_store.set(ready(await api.invoke("scheduled:list")));
  } catch (error) {
    console.error("[scheduled] scheduled:list failed", error);
    scheduled_store.set({ status: "failed", items: [] });
  }
};

export const save_scheduled = async (input: ScheduledInput, id: string | null) => {
  scheduled_store.set(ready(await api.invoke("scheduled:save", input, id)));
};

export const set_scheduled_enabled = async (id: string, enabled: boolean) => {
  scheduled_store.set(ready(await api.invoke("scheduled:set_enabled", id, enabled)));
};

export const remove_scheduled = async (id: string) => {
  scheduled_store.set(ready(await api.invoke("scheduled:remove", id)));
};

export const run_scheduled_now = async (id: string) => {
  scheduled_store.set(ready(await api.invoke("scheduled:run_now", id)));
};

export const init_scheduled = (): (() => void) => {
  void load_scheduled();
  const stops = [
    api.on("scheduled:changed", (tasks) => scheduled_store.set(ready(tasks))),
    api.on("scheduled:open_chat", ({ chat_id, project_path }) => open_chat(chat_id, project_path)),
  ];
  return () => stops.forEach((stop) => stop());
};

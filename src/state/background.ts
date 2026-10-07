import type { BackgroundTask } from "../../shared/ipc/work.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type BackgroundState = { chat_id: string | null; status: "idle" | "loading" | "ready" | "failed"; tasks: BackgroundTask[] };

export const background_store = create_store<BackgroundState>({ chat_id: null, status: "idle", tasks: [] });

const early: BackgroundTask[] = [];
let request = 0;
let settled = 0;

const newer = (current: BackgroundTask, incoming: BackgroundTask) =>
  current.status !== "running" && incoming.status === "running" ? current : incoming;

const upsert = (tasks: BackgroundTask[], task: BackgroundTask): BackgroundTask[] => {
  const index = tasks.findIndex((entry) => entry.id === task.id);
  if (index === -1) {
    return [...tasks, task];
  }
  return tasks.map((entry, position) => (position === index ? newer(entry, task) : entry));
};

export const load_background = async (chat_id: string | null) => {
  const ticket = ++request;
  early.length = 0;
  if (chat_id === null) {
    settled = ticket;
    background_store.set({ chat_id, status: "idle", tasks: [] });
    return;
  }
  const current = background_store.get();
  if (current.chat_id !== chat_id || current.status !== "ready") {
    background_store.set({ chat_id, status: "loading", tasks: [] });
  }
  try {
    const tasks = await api.invoke("background:list", chat_id);
    if (ticket !== request) {
      return;
    }
    settled = ticket;
    background_store.set({ chat_id, status: "ready", tasks: early.splice(0).reduce(upsert, tasks) });
  } catch (error) {
    console.error(`[background] background:list failed for chat ${chat_id}`, error);
    if (ticket === request) {
      settled = ticket;
      early.length = 0;
      background_store.set({ chat_id, status: "failed", tasks: [] });
    }
  }
};

export const cancel_background_task = async (task_id: string) => {
  try {
    await api.invoke("background:cancel", task_id);
  } catch (error) {
    console.error(`[background] background:cancel failed for task ${task_id}`, error);
  }
};

export const clear_finished_tasks = async (chat_id: string) => {
  try {
    await api.invoke("background:clear", chat_id);
  } catch (error) {
    console.error(`[background] background:clear failed for chat ${chat_id}`, error);
    return;
  }
  if (background_store.get().chat_id === chat_id) {
    background_store.update((state) => ({ ...state, tasks: state.tasks.filter((task) => task.status === "running") }));
  }
};

const receive = (task: BackgroundTask) => {
  const state = background_store.get();
  if (task.chat_id !== state.chat_id) {
    return;
  }
  if (state.status === "ready") {
    background_store.set({ ...state, tasks: upsert(state.tasks, task) });
  }
  if (request !== settled) {
    early.push(task);
  }
};

export const init_background = (): (() => void) => api.on("background:changed", receive);

import type { McpTier } from "../../shared/approval.ts";
import type { McpServerStatus, MemoryRecord, MemoryReviewItem, SkillEntry } from "../../shared/ipc/extensions.ts";
import type { McpServerConfig } from "../../shared/settings.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type LoadStatus = "loading" | "ready" | "failed";

export type Loaded<T> = { status: LoadStatus; items: T[] };

const initial = <T>(): Loaded<T> => ({ status: "loading", items: [] });

export const mcp_store = create_store<Loaded<McpServerStatus>>(initial());
export const skills_store = create_store<Loaded<SkillEntry>>(initial());
export const memory_store = create_store<Loaded<MemoryRecord>>(initial());
export const memory_review_store = create_store<Loaded<MemoryReviewItem>>(initial());

const ready = <T>(items: T[]): Loaded<T> => ({ status: "ready", items });

const load_into = async <T>(store: { set: (value: Loaded<T>) => void; get: () => Loaded<T> }, label: string, fetch: () => Promise<T[]>) => {
  if (store.get().status !== "ready") {
    store.set(initial());
  }
  try {
    store.set(ready(await fetch()));
  } catch (error) {
    console.error(`[extensions] ${label} failed`, error);
    store.set({ status: "failed", items: [] });
  }
};

export const load_mcp = () => load_into(mcp_store, "mcp:status", () => api.invoke("mcp:status"));

export const upsert_mcp_server = async (name: string, config: McpServerConfig) => {
  mcp_store.set(ready(await api.invoke("mcp:upsert", name, config)));
};

export const remove_mcp_server = async (name: string) => {
  mcp_store.set(ready(await api.invoke("mcp:remove", name)));
};

export const reconnect_mcp_server = async (name: string) => {
  mcp_store.set(ready(await api.invoke("mcp:reconnect", name)));
};

export const set_mcp_tool = async (server: string, tool: string, patch: { risk?: McpTier | null; enabled?: boolean }) => {
  mcp_store.set(ready(await api.invoke("mcp:set_tool", server, tool, patch)));
};

export const set_mcp_trust = async (server: string, trusted: boolean) => {
  mcp_store.set(ready(await api.invoke("mcp:set_trust", server, trusted)));
};

export const detect_mcp_folder = () => api.invoke("mcp:detect_folder");

export const load_skills = () => load_into(skills_store, "skills:list", () => api.invoke("skills:list"));

export const set_skill_enabled = async (slug: string, enabled: boolean) => {
  skills_store.set(ready(await api.invoke("skills:set_enabled", slug, enabled)));
};

export const remove_skill = async (slug: string) => {
  skills_store.set(ready(await api.invoke("skills:remove", slug)));
};

export const skill_body = (slug: string) => api.invoke("skills:body", slug);

export const open_skills_folder = () => api.invoke("skills:open_folder");

export const load_memory = () =>
  Promise.all([
    load_into(memory_store, "memory:list", () => api.invoke("memory:list")),
    load_into(memory_review_store, "memory:review", () => api.invoke("memory:review")),
  ]);

export const remove_memory = async (id: string) => {
  memory_store.set(ready(await api.invoke("memory:remove", id)));
};

export const resolve_memory_review = async (id: string, action: "keep" | "discard") => {
  memory_review_store.set(ready(await api.invoke("memory:resolve", id, action)));
  if (action === "keep") {
    await load_into(memory_store, "memory:list", () => api.invoke("memory:list"));
  }
};

export const reset_memory = async () => {
  await api.invoke("memory:reset");
  await load_memory();
};

export const init_extensions = (): (() => void) => api.on("mcp:changed", (servers) => mcp_store.set(ready(servers)));

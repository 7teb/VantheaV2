import { useEffect } from "react";
import type { GitFileDiff } from "../../shared/git-view.ts";
import { scope_key, type DiffScope, type DiffSummary } from "../../shared/turn-diff.ts";
import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";
import { settled, stale, starting, type GitLoad } from "./git-diff.ts";
import { use_store } from "./use-store.ts";

export type TurnDiffState = { summaries: Record<string, GitLoad<DiffSummary>>; files: Record<string, GitLoad<GitFileDiff>> };

type FileRequest = { chat_id: string; scope: DiffScope; path: string };

type Loads<T> = Record<string, GitLoad<T>>;

export const turn_diff_store = create_store<TurnDiffState>({ summaries: {}, files: {} });

const queued_summaries = new Map<string, Map<string, DiffScope>>();
const queued_files = new Map<string, FileRequest>();
const inflight = new Set<string>();
let scheduled = false;

const summary_key = (chat_id: string, scope: DiffScope) => `${chat_id}\n${scope_key(scope)}`;

const file_key = (chat_id: string, scope: DiffScope, path: string) => `${summary_key(chat_id, scope)}\n${path}`;

const of_chat = (chat_id: string) => (key: string) => key.startsWith(`${chat_id}\n`);

const with_loads = <T>(loads: Loads<T>, keys: string[], change: (load: GitLoad<T> | undefined) => GitLoad<T>, present_only: boolean): Loads<T> => {
  const next = { ...loads };
  for (const key of keys) {
    if (present_only && !next[key]) continue;
    next[key] = change(next[key]);
  }
  return next;
};

const mark_stale = <T>(loads: Loads<T>, hit: (key: string, load: GitLoad<T>) => boolean): Loads<T> => {
  let changed = false;
  const next: Loads<T> = {};
  for (const [key, load] of Object.entries(loads)) {
    const marked = hit(key, load) ? stale(load) : load;
    changed ||= marked !== load;
    next[key] = marked;
  }
  return changed ? next : loads;
};

const without = <T>(loads: Loads<T>, gone: (key: string) => boolean): Loads<T> => {
  const kept = Object.entries(loads).filter(([key]) => !gone(key));
  return kept.length === Object.keys(loads).length ? loads : Object.fromEntries(kept);
};

const send_summaries = async (chat_id: string, scopes: DiffScope[]) => {
  const keys = scopes.map((scope) => summary_key(chat_id, scope));
  let results: DiffSummary[] | null = null;
  try {
    results = await api.invoke("turn_diff:summaries", chat_id, scopes);
  } catch (error) {
    console.error(`[turn-diff] turn_diff:summaries failed for chat ${chat_id} and scopes ${scopes.map(scope_key).join(", ")}`, error);
  }
  for (const key of keys) {
    inflight.delete(key);
  }
  turn_diff_store.update((state) => {
    const summaries = { ...state.summaries };
    for (const [index, key] of keys.entries()) {
      const load = summaries[key];
      const result = results?.[index];
      if (!load) continue;
      summaries[key] = result ? settled(load, "ready", result) : settled(load, "failed", load.value);
    }
    return { ...state, summaries };
  });
};

const send_file = async (key: string, { chat_id, scope, path }: FileRequest) => {
  let finish: (load: GitLoad<GitFileDiff> | undefined) => GitLoad<GitFileDiff>;
  try {
    const diff = await api.invoke("turn_diff:file", chat_id, scope, path);
    finish = (load) => settled(load, "ready", diff);
  } catch (error) {
    console.error(`[turn-diff] turn_diff:file failed for ${path} in the diff ${scope_key(scope)} of chat ${chat_id}`, error);
    finish = (load) => settled(load, "failed", load?.value ?? null);
  }
  inflight.delete(key);
  turn_diff_store.update((state) => ({ ...state, files: with_loads(state.files, [key], finish, true) }));
};

const flush = () => {
  scheduled = false;
  const batches = [...queued_summaries.entries()].map(([chat_id, scopes]) => ({ chat_id, scopes: [...scopes.values()] }));
  const files = [...queued_files.entries()];
  queued_summaries.clear();
  queued_files.clear();
  const summary_keys = batches.flatMap(({ chat_id, scopes }) => scopes.map((scope) => summary_key(chat_id, scope)));
  turn_diff_store.update((state) => ({
    summaries: with_loads(state.summaries, summary_keys, starting, false),
    files: with_loads(
      state.files,
      files.map(([key]) => key),
      starting,
      false,
    ),
  }));
  for (const { chat_id, scopes } of batches) {
    void send_summaries(chat_id, scopes);
  }
  for (const [key, request] of files) {
    void send_file(key, request);
  }
};

const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
};

export const request_summary = (chat_id: string, scope: DiffScope) => {
  const key = summary_key(chat_id, scope);
  if (inflight.has(key)) return;
  inflight.add(key);
  const scopes = queued_summaries.get(chat_id) ?? new Map<string, DiffScope>();
  scopes.set(scope_key(scope), scope);
  queued_summaries.set(chat_id, scopes);
  schedule();
};

export const request_file = (chat_id: string, scope: DiffScope, path: string) => {
  const key = file_key(chat_id, scope, path);
  if (inflight.has(key)) return;
  inflight.add(key);
  queued_files.set(key, { chat_id, scope, path });
  schedule();
};

export const refresh_turn_diff = (chat_id: string) => {
  const hit = of_chat(chat_id);
  turn_diff_store.update((state) => {
    const summaries = mark_stale(state.summaries, hit);
    const files = mark_stale(state.files, hit);
    return summaries === state.summaries && files === state.files ? state : { summaries, files };
  });
};

const live_end = (load: GitLoad<DiffSummary>) => load.value?.kind === "ready" && load.value.end.kind === "live";

export const reload_live = (chat_id: string) => {
  const hit = of_chat(chat_id);
  turn_diff_store.update((state) => {
    const live = Object.entries(state.summaries).flatMap(([key, load]) => (hit(key) && live_end(load) ? [`${key}\n`] : []));
    if (live.length === 0) return state;
    const summaries = mark_stale(state.summaries, (key, load) => hit(key) && live_end(load));
    const files = mark_stale(state.files, (key) => live.some((prefix) => key.startsWith(prefix)));
    return { summaries, files };
  });
};

const drop_chat = (chat_id: string) => {
  const gone = of_chat(chat_id);
  turn_diff_store.update((state) => {
    const summaries = without(state.summaries, gone);
    const files = without(state.files, gone);
    return summaries === state.summaries && files === state.files ? state : { summaries, files };
  });
};

export const use_turn_summary = (chat_id: string | null, scope: DiffScope | null, live: boolean): GitLoad<DiffSummary> | null => {
  const key = chat_id === null || scope === null ? null : summary_key(chat_id, scope);
  const load = use_store(turn_diff_store, (state) => (key === null ? null : (state.summaries[key] ?? null)));
  useEffect(() => {
    if (live && chat_id !== null && scope !== null && (!load || !load.fresh)) {
      request_summary(chat_id, scope);
    }
  }, [live, key, load]);
  return load;
};

export const use_turn_file = (chat_id: string | null, scope: DiffScope | null, path: string | null, live: boolean): GitLoad<GitFileDiff> | null => {
  const key = chat_id === null || scope === null || path === null ? null : file_key(chat_id, scope, path);
  const load = use_store(turn_diff_store, (state) => (key === null ? null : (state.files[key] ?? null)));
  useEffect(() => {
    if (live && chat_id !== null && scope !== null && path !== null && (!load || !load.fresh)) {
      request_file(chat_id, scope, path);
    }
  }, [live, key, load]);
  return load;
};

export const init_turn_diff = (): (() => void) => {
  const stops = [api.on("turn_diff:changed", ({ chat_id }) => refresh_turn_diff(chat_id)), api.on("chats:removed", ({ chat_id }) => drop_chat(chat_id))];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};

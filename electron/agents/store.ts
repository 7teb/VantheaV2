import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AgentRunStatus, AgentSummary } from "../../shared/ipc/work.ts";
import type { ApiMessage } from "../model/types.ts";
import { as_array, error_text, is_record } from "../storage/coerce.ts";
import { keep_corrupt, read_json, write_json, write_json_sync } from "../storage/json-file.ts";
import { drop_journal } from "./journal.ts";
import {
  is_running,
  max_stored_agents,
  newest_first,
  parse_index,
  public_summary,
  stored_index,
  trim_runs,
  type AgentRecord,
  type RunRecord,
} from "./records.ts";

export type NewAgent = Pick<AgentRecord, "chat_id" | "name" | "description" | "model" | "effort" | "profile" | "project_root">;

export type AgentLookup = { agent: AgentRecord } | { agent: null; error: string };

type Listener = (summary: AgentSummary) => void;

const agents = new Map<string, AgentRecord>();

const listeners = new Set<Listener>();

let root: string | null = null;

const agents_root = (): string => {
  if (!root) {
    throw new Error("agent store used before init_agent_store");
  }
  return root;
};

const index_file = () => path.join(agents_root(), "index.json");

const agent_dir = (agent_id: string) => path.join(agents_root(), agent_id);

const context_file = (agent_id: string) => path.join(agent_dir(agent_id), "context.json");

export const run_file = (agent_id: string, run_id: string) => path.join(agent_dir(agent_id), `${run_id}.jsonl`);

const now_iso = () => new Date().toISOString();

const save_index = () => {
  const file = index_file();
  write_json(file, stored_index(agents.values())).catch((error: unknown) => {
    console.error(`[agents] saving ${file} failed: ${error_text(error)}`);
  });
};

const changed = (record: AgentRecord) => {
  const summary = public_summary(record);
  for (const listener of listeners) {
    try {
      listener(summary);
    } catch (error) {
      console.error(`[agents] change listener for agent ${record.agent_id} failed: ${error_text(error)}`);
    }
  }
};

export const init_agent_store = async (dir: string): Promise<void> => {
  root = dir;
  agents.clear();
  const file = index_file();
  const stored = await read_json(file);
  if (stored.status === "missing") {
    return;
  }
  if (stored.status === "corrupt") {
    console.error(`[agents] ${file} is not valid JSON (${stored.error}), keeping a copy at ${await keep_corrupt(file)}`);
    return;
  }
  const parsed = parse_index(stored.value, now_iso());
  for (const record of parsed.records) {
    agents.set(record.agent_id, record);
  }
  if (parsed.interrupted) {
    save_index();
  }
};

export const save_index_sync = (): void => {
  if (!root) {
    return;
  }
  const file = index_file();
  try {
    write_json_sync(file, stored_index(agents.values()));
  } catch (error) {
    console.error(`[agents] saving ${file} on quit failed: ${error_text(error)}`);
  }
};

export const on_agents_changed = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const get_agent = (agent_id: string): AgentRecord | null => agents.get(agent_id) ?? null;

export const chat_agents = (chat_id: string): AgentRecord[] => [...agents.values()].filter((record) => record.chat_id === chat_id).sort(newest_first);

export const list_agents = (chat_id: string): AgentSummary[] => chat_agents(chat_id).map(public_summary);

export const running_in_chat = (chat_id: string): number => chat_agents(chat_id).filter(is_running).length;

export const running_total = (): number => [...agents.values()].filter(is_running).length;

export const find_agent = (id: string, chat_id: string): AgentLookup => {
  const owned = chat_agents(chat_id);
  const exact = owned.find((record) => record.agent_id === id);
  const matches = exact ? [exact] : owned.filter((record) => id !== "" && record.agent_id.startsWith(id));
  const [only] = matches;
  if (only && matches.length === 1) {
    return { agent: only };
  }
  if (matches.length > 1) {
    return { agent: null, error: `${id} matches ${matches.length} agents (${matches.slice(0, 5).map((record) => record.agent_id).join(", ")}); pass more of the id.` };
  }
  return { agent: null, error: `No agent ${id} exists in this chat.` };
};

export const remove_agents = async (agent_ids: string[]): Promise<void> => {
  for (const agent_id of agent_ids) {
    const record = agents.get(agent_id);
    if (!record) {
      continue;
    }
    agents.delete(agent_id);
    for (const run of record.runs) {
      drop_journal(run_file(agent_id, run.run_id));
    }
  }
  save_index();
  await Promise.all(
    agent_ids.map((agent_id) =>
      fsp.rm(agent_dir(agent_id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch((error: unknown) => {
        console.error(`[agents] deleting ${agent_dir(agent_id)} failed: ${error_text(error)}`);
      }),
    ),
  );
};

const prune = () => {
  const idle = [...agents.values()].filter((record) => !is_running(record)).sort(newest_first);
  const excess = agents.size - max_stored_agents;
  if (excess > 0) {
    void remove_agents(idle.slice(-excess).map((record) => record.agent_id));
  }
};

export const create_agent = (fields: NewAgent): AgentRecord => {
  const now = now_iso();
  const record: AgentRecord = { ...fields, agent_id: `agent_${randomUUID()}`, created_at: now, updated_at: now, runs: [] };
  agents.set(record.agent_id, record);
  prune();
  return record;
};

export const begin_run = (record: AgentRecord, prompt: string, parent_message_id: string, parent_call_id?: string): RunRecord => {
  const now = now_iso();
  const run: RunRecord = { run_id: `run_${randomUUID()}`, prompt, status: "running", started_at: now, ended_at: null, report: "", parent_message_id, ...(parent_call_id ? { parent_call_id } : {}) };
  record.runs = trim_runs([...record.runs, run]);
  record.updated_at = now;
  save_index();
  changed(record);
  return run;
};

export const end_run = (agent_id: string, run_id: string, status: Exclude<AgentRunStatus, "running">, report: string): RunRecord | null => {
  const record = agents.get(agent_id);
  const run = record?.runs.find((entry) => entry.run_id === run_id);
  if (!record || !run || run.status !== "running") {
    return run ?? null;
  }
  run.status = status;
  run.ended_at = now_iso();
  run.report = report;
  record.updated_at = run.ended_at;
  save_index();
  changed(record);
  return run;
};

const valid_message = (entry: unknown): entry is ApiMessage => {
  if (!is_record(entry)) {
    return false;
  }
  if (entry.role === "user") {
    return typeof entry.content === "string" || Array.isArray(entry.content);
  }
  if (entry.role === "assistant") {
    return (typeof entry.content === "string" || entry.content === null) && (entry.tool_calls === undefined || Array.isArray(entry.tool_calls));
  }
  return entry.role === "tool" && typeof entry.tool_call_id === "string" && typeof entry.content === "string";
};

const parse_context = (value: unknown): ApiMessage[] => as_array(value).filter(valid_message);

export const save_context = async (agent_id: string, messages: ApiMessage[]): Promise<void> => {
  const file = context_file(agent_id);
  try {
    await write_json(file, messages);
  } catch (error) {
    console.error(`[agents] saving the context of agent ${agent_id} to ${file} failed: ${error_text(error)}`);
  }
};

export const load_context = async (agent_id: string): Promise<ApiMessage[]> => {
  const file = context_file(agent_id);
  const stored = await read_json(file);
  if (stored.status === "missing") {
    return [];
  }
  if (stored.status === "corrupt") {
    throw new Error(`the saved context of agent ${agent_id} (${file}) is not valid JSON: ${stored.error}`);
  }
  return parse_context(stored.value);
};

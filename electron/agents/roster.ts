import path from "node:path";
import type { Step } from "../../shared/chat.ts";
import { agent_label } from "../../shared/peer-notes.ts";
import { path_key } from "../storage/paths.ts";
import type { HeldEntry } from "./inbox.ts";
import { live_run, type LiveRun } from "./live.ts";
import { view_paths } from "./peer-steps.ts";
import { questions_asked_by, questions_asked_to, type OpenQuestion } from "./questions.ts";
import { current_run, type AgentRecord, type RunRecord } from "./records.ts";
import { chat_agents } from "./store.ts";

export type RosterEntry = {
  agent: AgentRecord;
  run: RunRecord | null;
  running: boolean;
  written: string[];
  read: string[];
  questions: OpenQuestion[];
};

type Paths = { scope: string[]; written: string[]; read: string[] };

const pad = (value: number) => String(value).padStart(2, "0");

export const clock = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const minutes_since = (at: number, now: number) => Math.max(0, Math.round((now - at) / 60_000));

export const topic_key = (topic: string): string => topic.trim().replace(/\s+/g, " ").toLowerCase();

export const same_topic = (a: AgentRecord, b: AgentRecord): boolean => topic_key(a.topic) !== "" && topic_key(a.topic) === topic_key(b.topic);

export const label_of = (agent: Pick<AgentRecord, "name" | "agent_id">): string => agent_label(agent.name, agent.agent_id);

export const profile_text = (agent: Pick<AgentRecord, "profile" | "without_tools">): string =>
  agent.without_tools.length ? `${agent.profile} (without ${agent.without_tools.join(", ")})` : agent.profile;

const steps_of = (run: RunRecord | null): Step[] => (run?.status === "running" ? (live_run(run.run_id)?.transcript.steps ?? []) : []);

export const roster_entries = (chat_id: string): RosterEntry[] =>
  chat_agents(chat_id)
    .toSorted((a, b) => a.created_at.localeCompare(b.created_at))
    .map((agent) => {
      const run = current_run(agent);
      const steps = steps_of(run);
      return { agent, run, running: run?.status === "running", written: view_paths(steps, "edit"), read: view_paths(steps, "read"), questions: questions_asked_by(agent.agent_id) };
    });

export const question_line = (question: OpenQuestion): string =>
  `to ${agent_label(question.to_name, question.to_id)} about ${question.about} since ${clock(question.at)} (${question.message_id})`;

const held_line = (entry: HeldEntry): string =>
  entry.from === "main"
    ? "an instruction from the main agent that it had not read when the app closed"
    : `${entry.type} ${entry.message_id} from ${agent_label(entry.sender_name, entry.sender_id)} about ${entry.about}`;

const held_text = (agent: AgentRecord): string =>
  agent.held.length ? `kept for its next run: ${agent.held.map(held_line).join("; ")} (continue_agent delivers them)` : "";

const task_of = (entry: RosterEntry) => entry.agent.description || entry.run?.prompt.split("\n")[0]?.trim() || "no task text";

const running_line = (entry: RosterEntry, self: AgentRecord | null, now: number): string => {
  const { agent } = entry;
  const started = Date.parse(entry.run?.started_at ?? "") || now;
  const own = self?.agent_id === agent.agent_id;
  const parts = [
    `${label_of(agent)}${own ? " (you)" : ""}`,
    `topic ${agent.topic || "none"}${self && !own && same_topic(self, agent) ? " (same topic as you)" : ""}`,
    agent.scope.length ? `scope ${agent.scope.join(", ")}` : "no scope",
    `${profile_text(agent)}, model ${agent.model}`,
    `running since ${clock(started)} (${minutes_since(started, now)} min)`,
  ];
  const written = entry.written.length ? ` Wrote: ${entry.written.join(", ")}.` : "";
  const questions = entry.questions.length ? ` Open questions: ${entry.questions.map(question_line).join("; ")}.` : "";
  const held = held_text(agent);
  return `${parts.join(", ")}. Task: ${task_of(entry)}.${written}${questions}${held ? ` Messages ${held}.` : ""}`;
};

const ended_line = (entry: RosterEntry, now: number | null = null): string => {
  const ended = Date.parse(entry.run?.ended_at ?? "");
  const status = entry.run?.status ?? "not started";
  const held = held_text(entry.agent);
  const limited = entry.agent.without_tools.length ? `, ${profile_text(entry.agent)}` : "";
  const age = now === null ? "" : ` (${minutes_since(ended, now)} min ago)`;
  return `${label_of(entry.agent)}, topic ${entry.agent.topic || "none"}${limited}, ${status}${Number.isFinite(ended) ? ` at ${clock(ended)}${age}` : ""}${held ? `, ${held}` : ""}`;
};

const entry_line = (entry: RosterEntry, self: AgentRecord | null, now: number) => (entry.running ? running_line(entry, self, now) : ended_line(entry, now));

export const roster_text = (entries: RosterEntry[], self_id: string | null, now = Date.now()): string => {
  const self = entries.find((entry) => entry.agent.agent_id === self_id)?.agent ?? null;
  const head =
    self_id === null
      ? `Agents in this chat at ${clock(now)}. You are the main agent; these are your sub-agents.`
      : `Agents in this chat at ${clock(now)}. The main agent leads the work; reach it with message_main_agent.`;
  const lines = entries.map((entry) => `- ${entry_line(entry, self, now)}`);
  return [head, ...(lines.length ? lines : ["- no sub-agents yet"])].join("\n");
};

export const roster_facts = (chat_id: string, self_id: string | null): string => {
  const entries = roster_entries(chat_id);
  if (!entries.length) {
    return "";
  }
  const incoming = self_id ? questions_asked_to(self_id) : [];
  const asked = incoming.map((question) => `from ${agent_label(question.asker_name, question.asker_id)} about ${question.about} (${question.message_id})`);
  return [roster_text(entries, self_id), ...(asked.length ? [`Questions to you that are still open, answer each with message_peer type answer and its in_reply_to id: ${asked.join("; ")}.`] : [])].join("\n");
};

const seen_value = (entry: RosterEntry) => `${entry.run?.run_id ?? ""}:${entry.run?.status ?? "none"}`;

const change_line = (entry: RosterEntry, before: string | undefined, self: AgentRecord | null, now: number): string => {
  if (entry.running) {
    return `${before === undefined ? "New" : "Running again"}: ${running_line(entry, self, now)}`;
  }
  return `${before === undefined ? "New and already ended" : "Ended"}: ${ended_line(entry)}. get_agent_status with agent_id ${entry.agent.agent_id} gives its report.`;
};

export const roster_delta = (live: LiveRun, entries: RosterEntry[], now = Date.now()): string | null => {
  const self = entries.find((entry) => entry.agent.agent_id === live.agent_id)?.agent ?? null;
  const first = live.roster_seen.size === 0;
  const lines: string[] = [];
  for (const entry of entries) {
    const id = entry.agent.agent_id;
    const value = seen_value(entry);
    const before = live.roster_seen.get(id);
    live.roster_seen.set(id, value);
    if (!first && before !== value && id !== live.agent_id) {
      lines.push(`- ${change_line(entry, before, self, now)}`);
    }
  }
  if (first) {
    return roster_text(entries, live.agent_id, now);
  }
  return lines.length ? [`Agents of this chat that started or ended since your last round (${clock(now)}):`, ...lines].join("\n") : null;
};

const in_project = (key: string) => !path.isAbsolute(key) && key !== ".." && !key.startsWith("../");

const inside = (file: string, scope: string) => {
  const [file_key, scope_key] = [path_key(file), path_key(scope)];
  if (scope_key === ".") {
    return in_project(file_key);
  }
  return file_key === scope_key || file_key.startsWith(`${scope_key}/`);
};

const same_path = (a: string, b: string) => path_key(a) === path_key(b);

const narrower_scope = (a: string, b: string): string | null => {
  if (inside(a, b)) {
    return a;
  }
  return inside(b, a) ? b : null;
};

const paths_of = (entry: RosterEntry): Paths => ({ scope: entry.agent.scope, written: entry.written, read: entry.read });

const relations = (own: Paths, peer: Paths, name: string): Map<string, string> => {
  const found = new Map<string, string>();
  const add = (path: string, text: string) => {
    if (!found.has(path_key(path))) {
      found.set(path_key(path), text);
    }
  };
  for (const mine of own.scope) {
    for (const theirs of peer.scope) {
      const narrower = narrower_scope(mine, theirs);
      if (narrower) {
        add(narrower, `both of you have ${narrower} in your scope`);
      }
    }
  }
  for (const file of own.written) {
    if (peer.scope.some((scope) => inside(file, scope))) {
      add(file, `you wrote ${file}, which is in the scope of ${name}`);
    } else if (peer.written.some((entry) => same_path(entry, file))) {
      add(file, `you and ${name} both wrote ${file}`);
    } else if (peer.read.some((entry) => same_path(entry, file))) {
      add(file, `you wrote ${file}, which ${name} read`);
    }
  }
  for (const file of peer.written) {
    if (own.scope.some((scope) => inside(file, scope))) {
      add(file, `${name} wrote ${file}, which is in your scope`);
    } else if (own.read.some((entry) => same_path(entry, file))) {
      add(file, `${name} wrote ${file}, which you read`);
    }
  }
  return found;
};

export const overlaps = (live: LiveRun, entries: RosterEntry[]): string[] => {
  const own = entries.find((entry) => entry.agent.agent_id === live.agent_id);
  if (!own) {
    return [];
  }
  return entries.flatMap((peer) => {
    if (!peer.running || peer.agent.agent_id === own.agent.agent_id) {
      return [];
    }
    const name = label_of(peer.agent);
    const fresh = [...relations(paths_of(own), paths_of(peer), name)].filter(([path]) => !live.overlaps_seen.has(`${peer.agent.agent_id}|${path}`));
    if (!fresh.length) {
      return [];
    }
    for (const [path] of fresh) {
      live.overlaps_seen.add(`${peer.agent.agent_id}|${path}`);
    }
    const topic = `topic ${peer.agent.topic || "none"}${same_topic(own.agent, peer.agent) ? ", same topic as you" : ""}`;
    return [`Overlap with ${name} (${topic}): ${fresh.map(([, text]) => text).join("; ")}. Agree with ${name} on who changes what, with message_peer.`];
  });
};

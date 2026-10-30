import { apply_event, apply_events } from "../../shared/apply-event.ts";
import type { AgentEvent, TranscriptState } from "../../shared/events.ts";
import type { AgentApproval, AgentRun } from "../../shared/ipc/work.ts";
import type { StoredContext } from "../context/calibration.ts";
import { error_text } from "../storage/coerce.ts";
import type { Emitter } from "../turn/session.ts";
import type { InboxEntry } from "./inbox.ts";
import { append_journal, flush_journal, read_journal } from "./journal.ts";
import { current_run, parse_event, public_run, type AgentRecord, type RunRecord, type StoredEvent } from "./records.ts";
import { get_agent, run_file } from "./store.ts";

export type StopReason = "cancelled" | "app_closed";

export type LiveRun = {
  agent_id: string;
  run_id: string;
  chat_id: string;
  workflow_run_id: string | null;
  controller: AbortController;
  transcript: TranscriptState;
  inbox: InboxEntry[];
  heard_at_call: number;
  roster_seen: Map<string, string>;
  overlaps_seen: Set<string>;
  resendable: Set<string>;
  kept_reports: string[];
  stop_reason: StopReason | null;
  finish_reason: string;
  removed: boolean;
  emit: Emitter;
  done: Promise<void>;
};

type EventListener = (event: AgentEvent) => void;

const app_closed_message = "The app was closed while this agent was running.";

const lives = new Map<string, LiveRun>();

const event_listeners = new Set<EventListener>();

const journal_entry = (event: StoredEvent): StoredEvent => {
  if (event.type !== "tool_draft") {
    return event;
  }
  const { delta, path, old_text, ...entry } = event;
  return entry;
};

const fresh_transcript = (): TranscriptState => ({
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
  ended_at: null,
});

export const on_agent_event = (listener: EventListener): (() => void) => {
  event_listeners.add(listener);
  return () => event_listeners.delete(listener);
};

const publish = (event: AgentEvent) => {
  for (const listener of event_listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(`[agents] event listener for run ${event.run_id} failed: ${error_text(error)}`);
    }
  }
};

export const create_live = (agent_id: string, run_id: string, chat_id: string, workflow_run_id: string | null = null): LiveRun => {
  const file = run_file(agent_id, run_id);
  let seq = 0;
  const live: LiveRun = {
    agent_id,
    run_id,
    chat_id,
    workflow_run_id,
    controller: new AbortController(),
    transcript: fresh_transcript(),
    inbox: [],
    heard_at_call: 0,
    roster_seen: new Map(),
    overlaps_seen: new Set(),
    resendable: new Set(),
    kept_reports: [],
    stop_reason: null,
    finish_reason: "",
    removed: false,
    done: Promise.resolve(),
    emit: (body) => {
      if (live.transcript.status !== "streaming") {
        return;
      }
      seq += 1;
      const event: StoredEvent = { ...body, seq, at: Date.now() };
      live.transcript = apply_event(live.transcript, event);
      if (live.removed) {
        return;
      }
      append_journal(file, journal_entry(event));
      publish({ ...event, agent_id, run_id });
    },
  };
  lives.set(run_id, live);
  return live;
};

export const live_run = (run_id: string): LiveRun | null => lives.get(run_id) ?? null;

export const live_runs = (): LiveRun[] => [...lives.values()];

export const reachable_live = (agent: AgentRecord): LiveRun | null => {
  const run = current_run(agent);
  const live = run?.status === "running" ? live_run(run.run_id) : null;
  return live && !live.stop_reason && !live.removed && live.transcript.status === "streaming" ? live : null;
};

export const unreachable_state = (agent: AgentRecord): string => {
  const status = current_run(agent)?.status;
  return status === "running" ? "is ending its run" : `is not running (${status ?? "never started"})`;
};

export const forget_live = (run_id: string): void => {
  lives.delete(run_id);
};

export const waiting_approvals = (chat_id: string): AgentApproval[] =>
  live_runs()
    .filter((live) => live.chat_id === chat_id && !live.removed && live.transcript.status === "streaming")
    .flatMap((live) =>
      live.transcript.steps.flatMap((step) =>
        step.kind === "tool" && step.status === "awaiting_approval" && step.approval
          ? [{ agent_id: live.agent_id, run_id: live.run_id, call_id: step.call_id, name: get_agent(live.agent_id)?.name ?? "", request: step.approval }]
          : [],
      ),
    );

export const app_closed_end = { type: "end", status: "interrupted", error: { kind: "app_closed", message: app_closed_message } } as const;

export const last_text = (transcript: Pick<TranscriptState, "steps">): string => {
  for (let index = transcript.steps.length - 1; index >= 0; index -= 1) {
    const step = transcript.steps[index];
    if (step?.kind === "text" && step.text.trim()) {
      return step.text.trim();
    }
  }
  return "";
};

export const report_text = (transcript: TranscriptState): string => {
  const last = transcript.steps.findLast((step) => step.kind === "text" && step.text.trim());
  if (!last) {
    return "";
  }
  let first_round = last.round;
  while (first_round > 0 && transcript.steps.some((step) => step.kind === "notice" && step.notice === "output_limit" && step.round === first_round - 1)) {
    first_round -= 1;
  }
  return transcript.steps
    .filter((step) => step.kind === "text" && step.round >= first_round && step.round <= last.round)
    .map((step) => step.kind === "text" ? step.text : "")
    .join("")
    .trim();
};

const late_label = "Messages arrived after the report above. The agent's last message after reading them:";

export const keep_report = (live: LiveRun): void => {
  const { steps } = live.transcript;
  const at = steps.findLastIndex((step) => step.kind === "text" && step.text.trim());
  if (at < 0 || steps.slice(at + 1).some((step) => step.kind === "tool")) {
    return;
  }
  const text = report_text(live.transcript);
  if (text !== live.kept_reports.at(-1)) {
    live.kept_reports.push(text);
  }
};

export const final_report = (live: LiveRun): string => {
  const parts = [...live.kept_reports, report_text(live.transcript)];
  return parts.filter((part, index) => part && part !== parts[index - 1]).join(`\n\n${late_label}\n\n`);
};

const settled = (transcript: TranscriptState, run: RunRecord): TranscriptState => {
  if (transcript.status !== "streaming" || run.status === "running") {
    return transcript;
  }
  const at = run.ended_at ? Date.parse(run.ended_at) : Date.now();
  return apply_event(transcript, { ...app_closed_end, seq: transcript.last_seq + 1, at: Number.isFinite(at) ? at : Date.now() });
};

const run_view = (agent: AgentRecord, run: RunRecord, transcript: TranscriptState): AgentRun => ({
  ...public_run(run),
  steps: transcript.steps,
  retry: transcript.retry,
  error: transcript.error,
  context: transcript.context,
  last_seq: transcript.last_seq,
  agent_id: agent.agent_id,
  name: agent.name,
});

export const read_agent_run = async (agent: AgentRecord, run: RunRecord): Promise<AgentRun> => {
  const live = lives.get(run.run_id);
  if (live) {
    return run_view(agent, run, live.transcript);
  }
  const file = run_file(agent.agent_id, run.run_id);
  await flush_journal(file);
  const events = (await read_journal(file))
    .map((value) => parse_event(value, agent.chat_id))
    .filter((event): event is StoredEvent => event !== null)
    .sort((a, b) => a.seq - b.seq);
  return run_view(agent, run, settled(apply_events(fresh_transcript(), events), run));
};

export const stored_agent_context = async (agent: AgentRecord): Promise<StoredContext> => {
  let floor: number | null = null;
  for (const run of agent.runs.toReversed()) {
    try {
      const { context } = await read_agent_run(agent, run);
      if (!context) {
        continue;
      }
      floor ??= context.floor ?? 0;
      if (context.calibration) {
        return { calibration: context.calibration, floor };
      }
    } catch (error) {
      console.error(`[agents] reading the context of run ${run.run_id} of agent ${agent.agent_id} failed, it seeds no calibration:`, error);
    }
  }
  return { calibration: null, floor: floor ?? 0 };
};

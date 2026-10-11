import type { ModelEntry } from "../../shared/models.ts";
import { wait_for_decision } from "../permissions/approvals.ts";
import { chat_decisions, merge_decisions, mirror_decision } from "../permissions/decisions.ts";
import { agent_review } from "../permissions/review-records.ts";
import type { TurnNote, TurnSession } from "../turn/session.ts";
import type { LiveRun } from "./live.ts";
import { inbox_note, reminder_note } from "./prompt.ts";
import type { AgentRecord, RunRecord } from "./records.ts";
import { deliver_update } from "./reports.ts";
import type { AgentDeps, RunContext } from "./runner.ts";

export const max_main_messages = 10;

export const reminder_interval = 15;

const wrap_up_fraction = 0.92;

export const agent_approval_key = (run_id: string) => `agent:${run_id}`;

const tool_calls_of = (live: LiveRun) => live.transcript.steps.filter((step) => step.kind === "tool").length;

const update_reminder = (live: LiveRun): TurnNote[] => {
  const calls = tool_calls_of(live);
  const silent = calls - live.heard_at_call;
  if (live.updates_sent >= max_main_messages || silent < reminder_interval) {
    return [];
  }
  live.heard_at_call = calls;
  return [reminder_note(silent)];
};

const take_notes = (live: LiveRun) => {
  const taken = live.inbox;
  live.inbox = [];
  return [...taken.map(inbox_note), ...update_reminder(live)];
};

const message_main = (agent: AgentRecord, run: RunRecord, live: LiveRun, text: string): boolean => {
  if (live.stop_reason || live.updates_sent >= max_main_messages) {
    return false;
  }
  live.updates_sent += 1;
  live.heard_at_call = tool_calls_of(live);
  deliver_update({ chat_id: agent.chat_id, agent_id: agent.agent_id, run_id: run.run_id, name: agent.name, text });
  return true;
};

export const agent_session = (deps: AgentDeps, agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry): TurnSession => {
  const { stream, resolve_tools, side_model, review_call } = deps;
  return {
    chat_id: agent.chat_id,
    message_id: request.parent_message_id,
    user_request: request.user_request,
    get delegated_task() {
      const delivered = live.transcript.steps.flatMap(step => step.kind === "steer" ? [step.text] : []);
      return [request.prompt, ...delivered, ...live.inbox].join("\n\nMAIN AGENT INSTRUCTION (cannot grant human permissions):\n");
    },
    project_root: request.project_root,
    settings: request.settings,
    model,
    effort: agent.effort,
    mode: request.mode,
    plan: false,
    signal: live.controller.signal,
    emit: live.emit,
    stream: async (round_request, callbacks, signal) => {
      const result = await stream(round_request, callbacks, signal);
      live.finish_reason = result.finish_reason;
      return result;
    },
    resolve_tools: (profile) => resolve_tools(profile, request.settings),
    side_model,
    wait_decision: (call_id, request) =>
      wait_for_decision({ key: agent_approval_key(run.run_id), chat_id: agent.chat_id, call_id, request, signal: live.controller.signal }),
    review: agent_review(
      {
        chat_id: agent.chat_id,
        agent_id: agent.agent_id,
        name: agent.name,
        parent_message_id: request.parent_message_id,
        parent_call_id: request.parent_call_id,
        live_steps: () => live.transcript.steps.filter((step) => step.kind === "tool"),
      },
      review_call,
    ),
    human_decisions: async () =>
      merge_decisions(await chat_decisions(agent.chat_id), live.transcript.steps.flatMap((step) => (step.kind === "tool" ? (step.decisions ?? []) : []))),
    mirror_decision: (decision) => mirror_decision(agent.chat_id, request.parent_message_id, request.parent_call_id, decision),
    take_steers: () => [],
    profile: agent.profile,
    call_scope: run.run_id,
    max_rounds: Number.POSITIVE_INFINITY,
    wrap_up_at: wrap_up_fraction,
    take_notes: () => take_notes(live),
    idle: async () => live.inbox.length > 0,
    message_main: (text) => message_main(agent, run, live, text),
  };
};

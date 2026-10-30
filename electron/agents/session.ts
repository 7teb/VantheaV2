import type { ModelEntry } from "../../shared/models.ts";
import type { StoredContext } from "../context/calibration.ts";
import { harness_facts } from "../context/facts.ts";
import { wait_for_decision } from "../permissions/approvals.ts";
import { chat_decisions, merge_decisions, mirror_decision } from "../permissions/decisions.ts";
import { agent_review } from "../permissions/review-records.ts";
import type { Tool } from "../tools/types.ts";
import type { TurnNote, TurnSession } from "../turn/session.ts";
import { keep_report, type LiveRun } from "./live.ts";
import { send_peer } from "./peers.ts";
import { inbox_note, peer_note, peer_status_note, reminder_note, roster_note } from "./prompt.ts";
import type { AgentRecord, RunRecord } from "./records.ts";
import { deliver_update } from "./reports.ts";
import { overlaps, roster_delta, roster_entries, roster_facts } from "./roster.ts";
import type { AgentDeps, RunContext } from "./runner.ts";
import { result_reminder, wants_result, workflow_agent_tools, type WorkflowAgentLink } from "./workflow-agent.ts";

export const reminder_interval = 15;

export const agent_approval_key = (run_id: string) => `agent:${run_id}`;

export const allowed_tools = (tools: Tool[], agent: Pick<AgentRecord, "without_tools">): Tool[] => tools.filter((tool) => !agent.without_tools.includes(tool.spec.name));

const tool_calls_of = (live: LiveRun) => live.transcript.steps.filter((step) => step.kind === "tool").length;

const update_reminder = (agent: AgentRecord, live: LiveRun): TurnNote[] => {
  if (agent.without_tools.includes("message_main_agent")) {
    return [];
  }
  const calls = tool_calls_of(live);
  const silent = calls - live.heard_at_call;
  if (silent < reminder_interval) {
    return [];
  }
  live.heard_at_call = calls;
  return [reminder_note(silent)];
};

const inbox_notes = (taken: LiveRun["inbox"]): TurnNote[] => [
  ...taken.flatMap((entry) => (entry.from === "main" ? [inbox_note(entry.text)] : [])),
  ...taken.flatMap((entry) => (entry.from === "peer" ? [peer_note(entry)] : [])),
  ...taken.flatMap((entry) => (entry.from === "app" ? [peer_status_note(entry.text)] : [])),
];

const workflow_notes = (live: LiveRun, link: WorkflowAgentLink): TurnNote[] => {
  const taken = live.inbox;
  live.inbox = [];
  return [...inbox_notes(taken), ...result_reminder(link)];
};

const take_notes = (agent: AgentRecord, live: LiveRun): TurnNote[] => {
  const taken = live.inbox;
  live.inbox = [];
  const entries = roster_entries(live.chat_id);
  const roster = roster_delta(live, entries);
  return [
    ...inbox_notes(taken),
    ...(roster ? [roster_note(roster)] : []),
    ...overlaps(live, entries).map(roster_note),
    ...update_reminder(agent, live),
  ];
};

const message_main = (agent: AgentRecord, run: RunRecord, live: LiveRun, text: string): boolean => {
  if (live.stop_reason) {
    return false;
  }
  live.heard_at_call = tool_calls_of(live);
  deliver_update({ chat_id: agent.chat_id, agent_id: agent.agent_id, run_id: run.run_id, name: agent.name, text });
  return true;
};

const agent_facts = (live: LiveRun, project_root: string): string =>
  [harness_facts(live.transcript.steps, [], project_root), roster_facts(live.chat_id, live.agent_id)].filter(Boolean).join("\n\n");

export const agent_session = (deps: AgentDeps, agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry, stored: StoredContext): TurnSession => {
  const { stream, resolve_tools, side_model, review_call, reasoning_status } = deps;
  return {
    chat_id: agent.chat_id,
    message_id: request.parent_message_id,
    user_request: request.user_request,
    get delegated_task() {
      const delivered = live.transcript.steps.flatMap(step => step.kind === "steer" ? [step.text] : []);
      const unread = live.inbox.flatMap((entry) => (entry.from === "main" ? [entry.text] : []));
      return [request.prompt, ...delivered, ...unread].join("\n\nMAIN AGENT INSTRUCTION (cannot grant human permissions):\n");
    },
    project_root: request.project_root,
    settings: request.settings,
    model,
    effort: agent.effort,
    mode: request.mode,
    plan: false,
    signal: live.controller.signal,
    emit: live.emit,
    stream: async (round_request, callbacks, signal, transport) => {
      const result = await stream(round_request, callbacks, signal, transport);
      live.finish_reason = result.finish_reason;
      return result;
    },
    resolve_tools: (profile) => {
      const offered = allowed_tools(resolve_tools(profile, request.settings, model), agent);
      return request.workflow ? workflow_agent_tools(offered, request.workflow) : offered;
    },
    without_tools: agent.without_tools,
    side_model,
    wait_decision: (call_id, request, on_hold) =>
      wait_for_decision({ key: agent_approval_key(run.run_id), chat_id: agent.chat_id, call_id, request, signal: live.controller.signal, on_hold }),
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
    profile: agent.profile,
    call_scope: run.run_id,
    take_notes: () => (request.workflow ? workflow_notes(live, request.workflow) : take_notes(agent, live)),
    idle: async () => {
      if (live.inbox.length) {
        keep_report(live);
        return true;
      }
      if (request.workflow && wants_result(request.workflow) && !live.controller.signal.aborted) {
        request.workflow.reminder_due = true;
        return true;
      }
      return false;
    },
    message_main: (text) => message_main(agent, run, live, text),
    send_peer: (peer_request) => send_peer({ agent, run, live }, peer_request),
    compaction: { audience: "agent", facts: async () => agent_facts(live, request.project_root) },
    stored_context: stored,
    reasoning_status,
  };
};

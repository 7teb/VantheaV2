import type { AgentRunStatus } from "../../shared/ipc/work.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { claude_plan_serves } from "../billing/claude.ts";
import type { StoredContext } from "../context/calibration.ts";
import type { ApiMessage } from "../model/types.ts";
import { cancel_chat } from "../permissions/approvals.ts";
import { clear_review_instance } from "../permissions/review-state.ts";
import { build_system_prompt } from "../prompts/index.ts";
import { error_text } from "../storage/coerce.ts";
import { push_notes, run_turn_loop } from "../turn/loop.ts";
import { close_journal } from "./journal.ts";
import { final_report, forget_live, type LiveRun } from "./live.ts";
import { on_peer_ended, return_undelivered } from "./peers.ts";
import { agent_role_section, kept_instruction_note, peer_note } from "./prompt.ts";
import { questions_asked_by } from "./questions.ts";
import type { AgentRecord, RunRecord } from "./records.ts";
import { write_report_file } from "./report-file.ts";
import { deliver_report, wake_idle } from "./reports.ts";
import { label_of, profile_text, question_line } from "./roster.ts";
import type { AgentDeps, RunContext } from "./runner.ts";
import { agent_approval_key, agent_session, allowed_tools } from "./session.ts";
import { end_run, run_file, save_context, set_agent_claude_session, take_held } from "./store.ts";
import { workflow_agent_tools, workflow_role_section, type WorkflowAgentLink } from "./workflow-agent.ts";

const final_status = (live: LiveRun): Exclude<AgentRunStatus, "running"> => {
  if (live.stop_reason === "cancelled") {
    return "cancelled";
  }
  if (live.stop_reason) {
    return "interrupted";
  }
  const status = live.transcript.status;
  if (status === "done") {
    return "completed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return status === "stopped" ? "cancelled" : "failed";
};

const ending_note = (live: LiveRun, status: AgentRunStatus): string => {
  if (status === "failed" || status === "interrupted") {
    return `The run ended early: ${live.transcript.error?.message ?? "unknown error"}.`;
  }
  return "";
};

const ended_report = (live: LiveRun, status: AgentRunStatus): string => {
  const text = final_report(live);
  const note = ending_note(live, status);
  if (!note) {
    return text;
  }
  return text ? `${note}\n\nLast output:\n${text}` : note;
};

export const with_open_questions = (agent: Pick<AgentRecord, "agent_id" | "name">, report: string): string => {
  const open = questions_asked_by(agent.agent_id).map((question) => `- Open question ${question_line(question)}, still without an answer.`);
  return open.length ? [report, `Open questions of ${label_of(agent)}:`, ...open].filter(Boolean).join("\n\n") : report;
};

const stop_reason_of = (live: LiveRun): string => {
  const error = live.transcript.error;
  if (error) {
    return `error ${error.kind}: ${error.message.slice(0, 300)}`;
  }
  return live.finish_reason || "unknown";
};

const close_open_calls = (messages: ApiMessage[]): ApiMessage[] => {
  const at = messages.findLastIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  const assistant = messages[at];
  if (!assistant || assistant.role !== "assistant" || !assistant.tool_calls) {
    return messages;
  }
  const after = messages.slice(at + 1);
  const answered = new Map(after.flatMap((message) => (message.role === "tool" ? [[message.tool_call_id, message] as const] : [])));
  if (assistant.tool_calls.every((call) => answered.has(call.id))) {
    return messages;
  }
  const results: ApiMessage[] = assistant.tool_calls.map((call) => answered.get(call.id) ?? { role: "tool", tool_call_id: call.id, content: "[not executed: the run stopped before this call ran]" });
  return [...messages.slice(0, at + 1), ...results, ...after.filter((message) => message.role !== "tool")];
};

const previous_run_id = (agent: AgentRecord, run: RunRecord): string | null => {
  const at = agent.runs.findIndex((entry) => entry.run_id === run.run_id);
  return at > 0 ? (agent.runs[at - 1]?.run_id ?? null) : null;
};

const settle_link = (link: WorkflowAgentLink, status: Exclude<AgentRunStatus, "running">, live: LiveRun) => {
  try {
    link.on_end({ status, report: final_report(live), error: live.transcript.error?.message ?? "" });
  } catch (error) {
    console.error(`[agents] handing the end of run ${live.run_id} to workflow ${link.run_id} failed:`, error);
  }
};

const finish = async (agent: AgentRecord, run: RunRecord, live: LiveRun, api_messages: ApiMessage[], link: WorkflowAgentLink | undefined) => {
  let status: Exclude<AgentRunStatus, "running"> = "failed";
  try {
    status = final_status(live);
    const report = with_open_questions(agent, ended_report(live, status));
    let report_path: string | null = null;
    let report_error = "";
    if (!live.removed) {
      if (api_messages.length > 1) {
        await save_context(agent.agent_id, close_open_calls(api_messages.slice(1)));
      }
      await close_journal(run_file(agent.agent_id, run.run_id));
      try {
        report_path = await write_report_file(agent.agent_id, run.run_id, report);
      } catch (error) {
        report_error = error_text(error);
        console.error(`[agents] saving report for run ${run.run_id} of agent ${agent.agent_id} failed:`, error);
      }
    }
    const ended = live.removed ? null : end_run(agent.agent_id, run.run_id, status, report);
    cancel_chat(agent_approval_key(run.run_id));
    clear_review_instance(agent.chat_id, agent.agent_id);
    return_undelivered(live);
    forget_live(run.run_id);
    if (ended) {
      on_peer_ended(agent);
      status = ended.status === "running" ? status : ended.status;
    }
    if (link) {
      wake_idle(agent.chat_id);
      return;
    }
    if (!ended || live.stop_reason === "cancelled" || live.stop_reason === "app_closed") {
      wake_idle(agent.chat_id);
      return;
    }
    deliver_report({
      chat_id: agent.chat_id,
      agent_id: agent.agent_id,
      run_id: run.run_id,
      name: agent.name,
      profile: profile_text(agent),
      model: agent.model,
      status: ended.status,
      started_at: ended.started_at,
      ended_at: ended.ended_at ?? new Date().toISOString(),
      report_path,
      report_error,
      stop_reason: stop_reason_of(live),
    });
  } catch (error) {
    console.error(`[agents] finishing run ${run.run_id} of agent ${agent.agent_id} failed:`, error);
  } finally {
    if (link) {
      settle_link(link, status, live);
    }
  }
};

export const drive = async (deps: () => AgentDeps, agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry, context: ApiMessage[], stored: StoredContext): Promise<void> => {
  const api_messages: ApiMessage[] = [];
  try {
    const offered = allowed_tools(deps().resolve_tools(agent.profile, request.settings, model), agent);
    const tools = request.workflow ? workflow_agent_tools(offered, request.workflow) : offered;
    const role = request.workflow ? workflow_role_section(agent, request.workflow) : agent_role_section(agent);
    const claude = claude_plan_serves(model);
    const system = await build_system_prompt({
      model,
      settings: request.settings,
      mode: request.mode,
      plan: false,
      personality: "pragmatic",
      project_root: request.project_root,
      chat_id: agent.chat_id,
      user_text: request.prompt,
      tools,
      user_attachments: false,
      effort: agent.effort,
      deferred_mcp: [],
      role,
      claude_plan: claude,
    });
    const held = take_held(agent.agent_id).map((entry) => (entry.from === "main" ? kept_instruction_note(entry.text) : peer_note(entry)));
    api_messages.push({ role: "system", content: system }, ...context);
    push_notes(live.emit, held, 0, api_messages);
    api_messages.push({ role: "user", instruction: true, content: request.prompt });
    const session = agent_session(deps(), agent, run, live, request, model, stored);
    if (!claude) {
      await run_turn_loop(session, api_messages);
      return;
    }
    const claude_turn = deps().claude_turn;
    if (!claude_turn) {
      throw new Error(`${model.label} runs on the Claude plan, but the agents were started without the Claude Code driver`);
    }
    await claude_turn(session, {
      api_messages,
      fresh_count: held.length + 1,
      compact_only: false,
      title: agent.name,
      turn_id: run.run_id,
      previous_turn_id: previous_run_id(agent, run),
      stored: agent.claude_session ?? null,
      save: async (ref) => set_agent_claude_session(agent.agent_id, ref),
    });
  } catch (error) {
    console.error(`[agents] run ${run.run_id} of agent ${agent.agent_id} failed to start:`, error);
    live.emit({ type: "end", status: "failed", error: { kind: "internal", message: error_text(error) } });
  } finally {
    await finish(agent, run, live, api_messages, request.workflow);
  }
};

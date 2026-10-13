import type { PermissionMode } from "../../shared/chat.ts";
import type { AgentRunStatus, AgentRunSummary, AgentSummary } from "../../shared/ipc/work.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import { no_stored_context, type StoredContext } from "../context/calibration.ts";
import type { ApiMessage } from "../model/types.ts";
import { cancel_chat } from "../permissions/approvals.ts";
import { clear_review_instance } from "../permissions/review-state.ts";
import { build_system_prompt } from "../prompts/index.ts";
import { render_section } from "../prompts/sections.ts";
import { error_text } from "../storage/coerce.ts";
import type { ReviewModelCall, SideModelCall, Tool, ToolProfile } from "../tools/types.ts";
import { without_images } from "../turn/carriers.ts";
import { push_notes, run_turn_loop } from "../turn/loop.ts";
import type { StreamFn } from "../turn/session.ts";
import { close_journal, flush_journals_sync } from "./journal.ts";
import { app_closed_end, create_live, final_report, forget_live, last_text, live_run, live_runs, reachable_live, stored_agent_context, type LiveRun, type StopReason } from "./live.ts";
import { deliver_to, forget_chat_peers, on_peer_ended, return_undelivered } from "./peers.ts";
import { agent_role_section, kept_instruction_note, peer_note } from "./prompt.ts";
import { questions_asked_by, sync_open_questions } from "./questions.ts";
import { current_run, public_run, public_summary, type AgentRecord, type RunRecord } from "./records.ts";
import { label_of, question_line } from "./roster.ts";
import { write_report_file } from "./report-file.ts";
import { deliver_report, drop_agent_notes, wake_idle } from "./reports.ts";
import { agent_approval_key, agent_session } from "./session.ts";
import {
  begin_run,
  chat_agents,
  create_agent,
  end_run,
  get_agent,
  init_agent_store,
  load_context,
  remove_agents,
  run_file,
  running_in_chat,
  save_context,
  save_index_sync,
  take_held,
} from "./store.ts";

export type AgentDeps = {
  dir: string;
  stream: StreamFn;
  resolve_tools: (profile: ToolProfile, settings: Settings, model: ModelEntry) => Tool[];
  side_model: SideModelCall;
  review_call: ReviewModelCall;
  models: () => Promise<ModelEntry[]>;
};

export type RunContext = {
  chat_id: string;
  parent_message_id: string;
  parent_call_id: string;
  project_root: string;
  user_request: string;
  mode: PermissionMode;
  settings: Settings;
  prompt: string;
};

export type DeployRequest = RunContext & Pick<AgentRecord, "name" | "description" | "topic" | "scope" | "profile" | "effort"> & { model: ModelEntry };

export type StartedRun = { agent: AgentSummary; run: AgentRunSummary };

export const max_running_agents = 20;

let deps: AgentDeps | null = null;

const current_deps = (): AgentDeps => {
  if (!deps) {
    throw new Error("agents used before init_agents");
  }
  return deps;
};

export const init_agents = async (options: AgentDeps): Promise<void> => {
  deps = options;
  await init_agent_store(options.dir);
};

export const find_agent_model = async (id: string): Promise<ModelEntry> => {
  const models = await current_deps().models();
  const found = models.find((model) => model.id === id);
  if (!found) {
    throw new Error(`Unknown model ${id}. Available models: ${models.map((model) => model.id).join(", ")}`);
  }
  return found;
};

export const ensure_capacity = (chat_id: string): void => {
  if (running_in_chat(chat_id) >= max_running_agents) {
    throw new Error(`At most ${max_running_agents} agents can run at once in this chat; wait for one to finish or cancel one.`);
  }
};

const stop_live = (live: LiveRun, reason: StopReason) => {
  if (live.stop_reason) {
    return;
  }
  live.stop_reason = reason;
  live.controller.abort(new Error(`agent run ${live.run_id} stopped: ${reason}`));
};

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

const with_open_questions = (agent: Pick<AgentRecord, "agent_id" | "name">, report: string): string => {
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
  const answered = new Set(messages.slice(at + 1).flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : [])));
  const missing: ApiMessage[] = assistant.tool_calls
    .filter((call) => !answered.has(call.id))
    .map((call) => ({ role: "tool", tool_call_id: call.id, content: "[not executed: the run stopped before this call ran]" }));
  return [...messages, ...missing];
};

const finish = async (agent: AgentRecord, run: RunRecord, live: LiveRun, api_messages: ApiMessage[]) => {
  try {
    const status = final_status(live);
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
      profile: agent.profile,
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
  }
};

const drive = async (agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry, context: ApiMessage[], stored: StoredContext): Promise<void> => {
  const api_messages: ApiMessage[] = [];
  try {
    const tools = current_deps().resolve_tools(agent.profile, request.settings, model);
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
    });
    const held = take_held(agent.agent_id).map((entry) => (entry.from === "main" ? kept_instruction_note(entry.text) : peer_note(entry)));
    api_messages.push({ role: "system", content: `${system}\n\n${render_section(agent_role_section(agent))}` }, ...context);
    push_notes(live.emit, held, 0, api_messages);
    api_messages.push({ role: "user", instruction: true, content: request.prompt });
    await run_turn_loop(agent_session(current_deps(), agent, run, live, request, model, stored), api_messages);
  } catch (error) {
    console.error(`[agents] run ${run.run_id} of agent ${agent.agent_id} failed to start:`, error);
    live.emit({ type: "end", status: "failed", error: { kind: "internal", message: error_text(error) } });
  } finally {
    await finish(agent, run, live, api_messages);
  }
};

const launch = (agent: AgentRecord, request: RunContext, model: ModelEntry, context: ApiMessage[], stored: StoredContext): StartedRun => {
  const run = begin_run(agent, request.prompt, request.parent_message_id, request.parent_call_id);
  sync_open_questions(agent.agent_id);
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id);
  live.done = drive(agent, run, live, request, model, context, stored);
  return { agent: public_summary(agent), run: public_run(run) };
};

export const deploy_agent = (request: DeployRequest): StartedRun => {
  ensure_capacity(request.chat_id);
  const agent = create_agent({
    chat_id: request.chat_id,
    name: request.name,
    description: request.description,
    topic: request.topic,
    scope: request.scope,
    model: request.model.id,
    effort: request.effort,
    profile: request.profile,
    project_root: request.project_root,
  });
  return launch(agent, request, request.model, [], no_stored_context);
};

const ensure_idle = (agent: AgentRecord) => {
  if (current_run(agent)?.status === "running") {
    throw new Error(`Agent ${agent.agent_id} is still running; steer it with message_agent or wait for its report.`);
  }
};

export const ensure_continuable = (agent: AgentRecord, project_root: string): void => {
  if (agent.project_root !== project_root) {
    throw new Error(`Agent ${agent.agent_id} belongs to the project ${agent.project_root}, not the open one.`);
  }
  ensure_idle(agent);
};

export const continue_agent = async (agent: AgentRecord, request: RunContext): Promise<StartedRun> => {
  ensure_continuable(agent, request.project_root);
  const model = await find_agent_model(agent.model);
  const saved = await load_context(agent);
  const context = model.vision ? saved : without_images(saved);
  const stored = await stored_agent_context(agent);
  ensure_idle(agent);
  ensure_capacity(agent.chat_id);
  return launch(agent, request, model, context, stored);
};

export const cancel_agent = (agent: AgentRecord): boolean => {
  const run = current_run(agent);
  if (run?.status !== "running") {
    return false;
  }
  const live = live_run(run.run_id);
  if (live) {
    stop_live(live, "cancelled");
  }
  end_run(agent.agent_id, run.run_id, "cancelled", live ? last_text(live.transcript) : "");
  on_peer_ended(agent);
  wake_idle(agent.chat_id);
  return true;
};

export const message_agent = (agent: AgentRecord, text: string): boolean => {
  const live = reachable_live(agent);
  if (!live) {
    return false;
  }
  deliver_to(live, { from: "main", text });
  return true;
};

export const clear_chat_agents = async (chat_id: string): Promise<void> => {
  drop_agent_notes(chat_id);
  forget_chat_peers(chat_id);
  const owned = chat_agents(chat_id).map((agent) => agent.agent_id);
  const settling: Promise<void>[] = [];
  for (const live of live_runs()) {
    if (live.chat_id !== chat_id) {
      continue;
    }
    live.removed = true;
    stop_live(live, "cancelled");
    settling.push(live.done);
  }
  await Promise.all(settling);
  await remove_agents(owned);
};

export const shutdown_agents_sync = (): void => {
  const reports = new Map(live_runs().map((live) => [live.run_id, with_open_questions({ agent_id: live.agent_id, name: get_agent(live.agent_id)?.name ?? "Agent" }, final_report(live))]));
  for (const live of live_runs()) {
    return_undelivered(live, true);
  }
  for (const live of live_runs()) {
    live.emit(app_closed_end);
    stop_live(live, "app_closed");
    end_run(live.agent_id, live.run_id, "interrupted", reports.get(live.run_id) ?? "");
  }
  flush_journals_sync();
  save_index_sync();
};

import type { PermissionMode } from "../../shared/chat.ts";
import type { AgentRunStatus, AgentRunSummary, AgentSummary } from "../../shared/ipc/work.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import type { ApiMessage } from "../model/types.ts";
import { cancel_chat, wait_for_decision } from "../permissions/approvals.ts";
import { build_system_prompt } from "../prompts/index.ts";
import { render_section } from "../prompts/sections.ts";
import { error_text } from "../storage/coerce.ts";
import type { SideModelCall, Tool, ToolProfile } from "../tools/types.ts";
import { run_turn_loop } from "../turn/loop.ts";
import type { StreamFn, TurnNote, TurnSession } from "../turn/session.ts";
import { close_journal, flush_journals_sync } from "./journal.ts";
import { app_closed_end, create_live, forget_live, last_text, live_run, live_runs, report_text, type LiveRun, type StopReason } from "./live.ts";
import { agent_role_section, inbox_note, reminder_note } from "./prompt.ts";
import { current_run, public_run, public_summary, type AgentRecord, type RunRecord } from "./records.ts";
import { write_report_file } from "./report-file.ts";
import { deliver_report, deliver_update, drop_agent_notes, wake_idle } from "./reports.ts";
import {
  begin_run,
  chat_agents,
  create_agent,
  end_run,
  init_agent_store,
  load_context,
  remove_agents,
  run_file,
  running_total,
  save_context,
  save_index_sync,
} from "./store.ts";

export type AgentDeps = {
  dir: string;
  stream: StreamFn;
  resolve_tools: (profile: ToolProfile, settings: Settings) => Tool[];
  side_model: SideModelCall;
  models: () => Promise<ModelEntry[]>;
};

export type RunContext = {
  chat_id: string;
  parent_message_id: string;
  project_root: string;
  user_request: string;
  authorization?: () => string;
  mode: PermissionMode;
  settings: Settings;
  prompt: string;
};

export type DeployRequest = RunContext & Pick<AgentRecord, "name" | "description" | "profile" | "effort"> & { model: ModelEntry };

export type StartedRun = { agent: AgentSummary; run: AgentRunSummary };

export const max_running_agents = 8;

export const max_agent_rounds = 300;

export const agent_time_limit_ms = 4 * 60 * 60 * 1000;

export const max_main_messages = 10;

export const reminder_interval = 15;

const wrap_up_fraction = 0.92;

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

export const agent_approval_key = (run_id: string) => `agent:${run_id}`;

export const find_agent_model = async (id: string): Promise<ModelEntry> => {
  const models = await current_deps().models();
  const found = models.find((model) => model.id === id);
  if (!found) {
    throw new Error(`Unknown model ${id}. Available models: ${models.map((model) => model.id).join(", ")}`);
  }
  return found;
};

const ensure_capacity = () => {
  if (running_total() >= max_running_agents) {
    throw new Error(`At most ${max_running_agents} agents can run at once; wait for one to finish or cancel one.`);
  }
};

const stop_live = (live: LiveRun, reason: StopReason) => {
  if (live.stop_reason) {
    return;
  }
  live.stop_reason = reason;
  live.controller.abort(new Error(`agent run ${live.run_id} stopped: ${reason}`));
};

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
  if (live.stop_reason === "time_limit") {
    return `The run reached its ${agent_time_limit_ms / 3_600_000}-hour limit and was stopped.`;
  }
  if (status === "failed" || status === "interrupted") {
    return `The run ended early: ${live.transcript.error?.message ?? "unknown error"}.`;
  }
  return "";
};

const report_of = (live: LiveRun, status: AgentRunStatus): string => {
  const text = report_text(live.transcript);
  const note = ending_note(live, status);
  if (!note) {
    return text;
  }
  return text ? `${note}\n\nLast output:\n${text}` : note;
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

const message_main = (agent: AgentRecord, run: RunRecord, live: LiveRun, text: string): boolean => {
  if (live.stop_reason || live.updates_sent >= max_main_messages) {
    return false;
  }
  live.updates_sent += 1;
  live.heard_at_call = tool_calls_of(live);
  deliver_update({ chat_id: agent.chat_id, agent_id: agent.agent_id, run_id: run.run_id, name: agent.name, text });
  return true;
};

const agent_session = (agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry): TurnSession => {
  const { stream, resolve_tools, side_model } = current_deps();
  return {
    chat_id: agent.chat_id,
    message_id: request.parent_message_id,
    user_request: request.user_request,
    authorization: request.authorization,
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
    stream,
    resolve_tools: (profile) => resolve_tools(profile, request.settings),
    side_model,
    wait_decision: (call_id) => wait_for_decision(agent_approval_key(run.run_id), call_id, live.controller.signal),
    take_steers: () => [],
    profile: agent.profile,
    call_scope: run.run_id,
    max_rounds: max_agent_rounds,
    wrap_up_at: wrap_up_fraction,
    take_notes: () => take_notes(live),
    idle: async () => live.inbox.length > 0,
    message_main: (text) => message_main(agent, run, live, text),
  };
};

const finish = async (agent: AgentRecord, run: RunRecord, live: LiveRun, api_messages: ApiMessage[]) => {
  try {
    const status = final_status(live);
    const report = report_of(live, status);
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
    forget_live(run.run_id);
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
    });
  } catch (error) {
    console.error(`[agents] finishing run ${run.run_id} of agent ${agent.agent_id} failed:`, error);
  }
};

const drive = async (agent: AgentRecord, run: RunRecord, live: LiveRun, request: RunContext, model: ModelEntry, context: ApiMessage[]): Promise<void> => {
  const timer = setTimeout(() => stop_live(live, "time_limit"), agent_time_limit_ms);
  timer.unref();
  const api_messages: ApiMessage[] = [];
  try {
    const tools = current_deps().resolve_tools(agent.profile, request.settings);
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
      has_file_attachments: false,
      effort: agent.effort,
    });
    api_messages.push({ role: "system", content: `${system}\n\n${render_section(agent_role_section(agent))}` }, ...context, { role: "user", content: request.prompt });
    await run_turn_loop(agent_session(agent, run, live, request, model), api_messages);
  } catch (error) {
    console.error(`[agents] run ${run.run_id} of agent ${agent.agent_id} failed to start:`, error);
    live.emit({ type: "end", status: "failed", error: { kind: "internal", message: error_text(error) } });
  } finally {
    clearTimeout(timer);
    await finish(agent, run, live, api_messages);
  }
};

const launch = (agent: AgentRecord, request: RunContext, model: ModelEntry, context: ApiMessage[]): StartedRun => {
  const run = begin_run(agent, request.prompt, request.parent_message_id);
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id);
  live.done = drive(agent, run, live, request, model, context);
  return { agent: public_summary(agent), run: public_run(run) };
};

export const deploy_agent = (request: DeployRequest): StartedRun => {
  ensure_capacity();
  const agent = create_agent({
    chat_id: request.chat_id,
    name: request.name,
    description: request.description,
    model: request.model.id,
    effort: request.effort,
    profile: request.profile,
    project_root: request.project_root,
  });
  return launch(agent, request, request.model, []);
};

const ensure_idle = (agent: AgentRecord) => {
  if (current_run(agent)?.status === "running") {
    throw new Error(`Agent ${agent.agent_id} is still running; steer it with message_agent or wait for its report.`);
  }
};

export const continue_agent = async (agent: AgentRecord, request: RunContext): Promise<StartedRun> => {
  if (agent.project_root !== request.project_root) {
    throw new Error(`Agent ${agent.agent_id} belongs to the project ${agent.project_root}, not the open one.`);
  }
  ensure_idle(agent);
  const model = await find_agent_model(agent.model);
  const context = await load_context(agent.agent_id);
  ensure_idle(agent);
  ensure_capacity();
  return launch(agent, request, model, context);
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
  wake_idle(agent.chat_id);
  return true;
};

export const message_agent = (agent: AgentRecord, text: string): boolean => {
  const run = current_run(agent);
  const live = run?.status === "running" ? live_run(run.run_id) : null;
  if (!live || live.stop_reason) {
    return false;
  }
  live.inbox.push(text);
  return true;
};

export const clear_chat_agents = async (chat_id: string): Promise<void> => {
  drop_agent_notes(chat_id);
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
  for (const live of live_runs()) {
    live.emit(app_closed_end);
    stop_live(live, "app_closed");
    end_run(live.agent_id, live.run_id, "interrupted", last_text(live.transcript));
  }
  flush_journals_sync();
  save_index_sync();
};

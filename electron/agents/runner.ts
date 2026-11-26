import type { PermissionMode } from "../../shared/chat.ts";
import type { AgentProfile, AgentRunSummary, AgentSummary } from "../../shared/ipc/work.ts";
import { listed_model, model_listing, type ModelEntry } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import { no_stored_context, type StoredContext } from "../context/calibration.ts";
import { max_running_agents, user_config_file } from "../settings/user-config.ts";
import type { ApiMessage } from "../model/types.ts";
import type { ReviewModelCall, SideModelCall, Tool, ToolProfile } from "../tools/types.ts";
import { without_images } from "../turn/carriers.ts";
import type { ClaudeTurnInput } from "../turn/claude/drive.ts";
import type { ReasoningStatusCall, StreamFn, TurnSession } from "../turn/session.ts";
import { flush_journals_sync } from "./journal.ts";
import { app_closed_end, create_live, final_report, last_text, live_run, live_runs, reachable_live, stored_agent_context, type LiveRun, type StopReason } from "./live.ts";
import { deliver_to, forget_chat_peers, on_peer_ended, return_undelivered } from "./peers.ts";
import { sync_open_questions } from "./questions.ts";
import { current_run, is_running, public_run, public_summary, type AgentRecord } from "./records.ts";
import { drop_agent_notes, wake_idle } from "./reports.ts";
import { drive, with_open_questions } from "./run-drive.ts";
import type { WorkflowAgentLink } from "./workflow-agent.ts";
import {
  begin_run,
  chat_agents,
  create_agent,
  end_run,
  get_agent, retain_agent,
  init_agent_store,
  load_context,
  remove_agents,
  running_in_chat,
  save_index_sync,
} from "./store.ts";

export type AgentDeps = {
  dir: string;
  stream: StreamFn;
  resolve_tools: (profile: ToolProfile, settings: Settings, model: ModelEntry) => Tool[];
  side_model: SideModelCall;
  review_call: ReviewModelCall;
  models: () => Promise<ModelEntry[]>;
  reasoning_status?: ReasoningStatusCall;
  claude_turn?: (session: TurnSession, input: ClaudeTurnInput) => Promise<void>;
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
  workflow?: WorkflowAgentLink;
};

export type DeployRequest = RunContext & Pick<AgentRecord, "name" | "description" | "topic" | "scope" | "profile" | "without_tools" | "effort"> & { model: ModelEntry; model_id?: string };

export type StartedRun = { agent: AgentSummary; run: AgentRunSummary };


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
  const listed = model_listing(models, id);
  if (!listed) {
    throw new Error(`Unknown model ${id}. Available models: ${models.map((model) => model.id).join(", ")}`);
  }
  return listed_model(listed);
};

export const validate_without_tools = (profile: AgentProfile, names: string[], settings: Settings, model: ModelEntry): string[] => {
  const offered = current_deps().resolve_tools(profile, settings, model).map((tool) => tool.spec.name);
  const unknown = names.filter((name) => !offered.includes(name));
  if (unknown.length) {
    throw new Error(`without_tools can only remove tools of the ${profile} profile; ${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not among them. Tools of the ${profile} profile: ${offered.join(", ")}.`);
  }
  return [...new Set(names)];
};

export const running_agent_roots = (): string[] =>
  live_runs().flatMap((live) => {
    const agent = get_agent(live.agent_id);
    return agent && is_running(agent) ? [agent.project_root] : [];
  });

const in_workflow_run = (agent: AgentRecord): boolean => {
  const run = current_run(agent);
  return run?.status === "running" && Boolean(live_run(run.run_id)?.workflow_run_id);
};

export const ensure_capacity = (chat_id: string): void => {
  const limit = max_running_agents();
  if (running_in_chat(chat_id) - chat_agents(chat_id).filter(in_workflow_run).length >= limit) {
    throw new Error(`At most ${limit} agents can run at once in this chat; wait for one to finish or cancel one. The limit is max_running_agents in ${user_config_file()}.`);
  }
};

const stop_live = (live: LiveRun, reason: StopReason) => {
  if (live.stop_reason) {
    return;
  }
  live.stop_reason = reason;
  live.controller.abort(new Error(`agent run ${live.run_id} stopped: ${reason}`));
};

const launch = (agent: AgentRecord, request: RunContext, model: ModelEntry, context: ApiMessage[], stored: StoredContext): StartedRun => {
  const run = begin_run(agent, request.prompt, request.parent_message_id, request.parent_call_id);
  sync_open_questions(agent.agent_id);
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id, request.workflow?.run_id ?? null);
  live.done = drive(current_deps, agent, run, live, request, model, context, stored);
  return { agent: public_summary(agent), run: public_run(run) };
};

export const deploy_agent = (request: DeployRequest): StartedRun => {
  if (!request.workflow) {
    ensure_capacity(request.chat_id);
  }
  const agent = create_agent({
    chat_id: request.chat_id,
    name: request.name,
    description: request.description,
    topic: request.topic,
    scope: request.scope,
    model: request.model_id ?? request.model.id,
    effort: request.effort,
    profile: request.profile,
    without_tools: request.without_tools,
    project_root: request.project_root,
    ...(request.workflow ? { workflow: { run_id: request.workflow.run_id, index: request.workflow.index } } : {}),
  });
  return launch(agent, request, request.model, [], no_stored_context);
};

const ensure_idle = (agent: AgentRecord) => {
  if (get_agent(agent.agent_id) !== agent) throw new Error(`Agent ${agent.agent_id} is no longer available.`);
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
  const release = retain_agent(agent);
  try {
    const model = await find_agent_model(agent.model);
    const saved = await load_context(agent);
    const context = model.vision ? saved : without_images(saved);
    const stored = await stored_agent_context(agent);
    ensure_idle(agent);
    ensure_capacity(agent.chat_id);
    return launch(agent, request, model, context, stored);
  } finally {
    release();
  }
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

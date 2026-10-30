import type { WorkflowAgentStatus } from "../../shared/workflow.ts";
import { cancel_agent, deploy_agent, find_agent_model } from "../agents/runner.ts";
import { get_agent } from "../agents/store.ts";
import type { WorkflowAgentEnd, WorkflowAgentLink } from "../agents/workflow-agent.ts";
import { resolve_effort } from "../model/catalog.ts";
import { error_text } from "../storage/coerce.ts";
import type { JsonSchema } from "../tools/types.ts";
import { create_agent_worktree, release_agent_worktree } from "./isolation.ts";
import { add_agent, add_phase, close_call, journal_end, now_iso, open_call, patch_agent, preview_of, type CallState, type LiveWorkflow } from "./live.ts";
import type { HookCall } from "./protocol.ts";
import { call_key, type CallEndStatus } from "./records.ts";
import type { Hit } from "./replay.ts";
import { resolve_role, type ResolvedRole, type RoleBook } from "./roles.ts";
import { check_schema } from "./schema.ts";
import { append_call } from "./store.ts";

type AgentCall = Extract<HookCall, { kind: "agent" }>;

type AgentPlan = {
  prompt: string;
  label: string;
  phase: string | null;
  role: ResolvedRole;
  model_id: string;
  effort: string;
  schema: JsonSchema | null;
  isolation: boolean;
};

type Outcome = { kind: "value"; value: unknown } | { kind: "error"; text: string };

const text_opt = (opts: Record<string, unknown>, key: string): string => (typeof opts[key] === "string" ? (opts[key] as string).trim() : "");

const default_label = (run: LiveWorkflow) => `${run.meta.name} #${run.agent_count}`;

const scoped_roles = (run: LiveWorkflow, scope: number | null): RoleBook => {
  const own = scope === null ? undefined : run.child_roles.get(scope);
  return own ? { ...run.roles, script: { ...run.roles.script, ...own } } : run.roles;
};

const plan_call = (run: LiveWorkflow, item: AgentCall): AgentPlan => {
  const { opts } = item;
  const role = resolve_role(scoped_roles(run, item.scope), opts.role);
  const problem = opts.schema === undefined ? null : check_schema(opts.schema);
  if (problem) {
    throw new Error(`agent(): ${problem}`);
  }
  return {
    prompt: item.prompt,
    label: text_opt(opts, "label") || default_label(run),
    phase: typeof opts.phase === "string" ? opts.phase : null,
    role,
    model_id: text_opt(opts, "model") || role.spec.model || run.context.model_id,
    effort: text_opt(opts, "effort") || role.spec.effort || run.context.effort,
    schema: opts.schema === undefined ? null : (opts.schema as JsonSchema),
    isolation: opts.isolation === "worktree",
  };
};

const plan_key = (plan: AgentPlan, opts: Record<string, unknown>): string =>
  call_key(["agent", plan.prompt, { label: opts.label, phase: plan.phase, schema: plan.schema, isolation: plan.isolation }, plan.role.name, plan.role.spec, plan.model_id, plan.effort]);

export const settle_sandbox = (run: LiveWorkflow, id: number, ok: boolean, text: string): number => (run.sandbox && !run.ended ? run.sandbox.settle(id, ok, text) : -1);

const finish_call = (run: LiveWorkflow, call: CallState, status: CallEndStatus, entry: WorkflowAgentStatus, outcome: Outcome, error = ""): number => {
  if (!close_call(run, call)) {
    return -1;
  }
  const value = outcome.kind === "value" ? outcome.value : null;
  journal_end(run, call.index, status, status === "completed" || status === "skipped" ? value : null);
  patch_agent(run, call.index, { status: entry, ended_at: now_iso(), preview: outcome.kind === "value" ? preview_of(value) : "", error: outcome.kind === "error" ? outcome.text : error });
  if (outcome.kind === "error") {
    return settle_sandbox(run, call.id, false, outcome.text);
  }
  return settle_sandbox(run, call.id, true, JSON.stringify(value ?? null));
};

const release_tree = async (run: LiveWorkflow, call: CallState): Promise<void> => {
  const tree = call.worktree;
  if (!tree) {
    return;
  }
  call.worktree = null;
  try {
    const kept = await release_agent_worktree(tree);
    patch_agent(run, call.index, { worktree: { path: tree.dir, branch: tree.branch, kept } });
  } catch (error) {
    console.error(`[workflows] releasing the worktree ${tree.path} of call ${call.index} in ${run.run_id} failed, it stays:`, error);
    patch_agent(run, call.index, { worktree: { path: tree.dir, branch: tree.branch, kept: true } });
  }
};

const end_status: Record<WorkflowAgentEnd["status"], { status: CallEndStatus; entry: WorkflowAgentStatus }> = {
  completed: { status: "completed", entry: "completed" },
  cancelled: { status: "skipped", entry: "skipped" },
  failed: { status: "failed", entry: "failed" },
  interrupted: { status: "interrupted", entry: "interrupted" },
};

const agent_ended = async (run: LiveWorkflow, call: CallState, link: WorkflowAgentLink, end: WorkflowAgentEnd): Promise<void> => {
  await release_tree(run, call);
  if (call.settled) {
    return;
  }
  const mapped = end_status[end.status];
  if (end.status !== "completed") {
    const why = end.status === "cancelled" ? "skipped" : end.error || `the agent run ended ${end.status}`;
    finish_call(run, call, mapped.status, mapped.entry, { kind: "value", value: null }, why);
    return;
  }
  if (link.schema && !link.result) {
    const last = first_line(end.report);
    finish_call(run, call, "failed", "failed", { kind: "value", value: null }, last ? `the agent finished without a valid structured result, its last message: ${last}` : "the agent finished without a valid structured result");
    return;
  }
  finish_call(run, call, "completed", "completed", { kind: "value", value: link.schema ? (link.result?.value ?? null) : end.report });
};

const first_line = (text: string) => (text.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 240);

const start_live = async (run: LiveWorkflow, call: CallState, plan: AgentPlan): Promise<void> => {
  try {
    const model = await find_agent_model(plan.model_id);
    const effort = resolve_effort(model, plan.effort);
    patch_agent(run, call.index, { model: model.id, effort });
    if (run.ended) {
      return;
    }
    if (call.skip) {
      finish_call(run, call, "skipped", "skipped", { kind: "value", value: null }, "skipped before it started");
      return;
    }
    let project_root = run.context.project_root;
    if (plan.isolation) {
      const tree = await create_agent_worktree(run.context.project_path, run.context.project_root, plan.label);
      call.worktree = tree;
      project_root = tree.dir;
      patch_agent(run, call.index, { worktree: { path: tree.dir, branch: tree.branch, kept: false } });
      if (run.ended || call.skip) {
        await release_tree(run, call);
        finish_call(run, call, "skipped", "skipped", { kind: "value", value: null }, "skipped before it started");
        return;
      }
    }
    const link: WorkflowAgentLink = {
      run_id: run.run_id,
      workflow_name: run.meta.name,
      index: call.index,
      role_name: plan.role.name,
      instructions: plan.role.spec.instructions,
      schema: plan.schema,
      worktree: call.worktree ? { dir: call.worktree.dir, branch: call.worktree.branch, base: call.worktree.base } : null,
      result: null,
      reminder_due: false,
      on_end: (end) => {
        agent_ended(run, call, link, end).catch((error: unknown) => console.error(`[workflows] ending call ${call.index} of ${run.run_id} failed:`, error));
      },
    };
    const { context } = run;
    const started = deploy_agent({
      chat_id: context.chat_id,
      parent_message_id: context.parent_message_id,
      parent_call_id: context.parent_call_id,
      project_root,
      user_request: context.user_request,
      mode: context.mode,
      settings: context.settings,
      prompt: plan.prompt,
      workflow: link,
      name: plan.label,
      description: first_line(plan.prompt),
      topic: run.meta.name,
      scope: [],
      profile: plan.role.spec.profile,
      without_tools: [],
      effort,
      model,
    });
    call.agent_id = started.agent.agent_id;
    patch_agent(run, call.index, { status: "running", agent_id: started.agent.agent_id, agent_run_id: started.run.run_id, started_at: started.run.started_at });
  } catch (error) {
    console.error(`[workflows] starting call ${call.index} of ${run.run_id} failed:`, error);
    await release_tree(run, call);
    finish_call(run, call, "failed", "failed", { kind: "error", text: error_text(error) });
  }
};

const deliver_hit = (run: LiveWorkflow, call: CallState, hit: Hit): number => {
  if (call.skip) {
    return finish_call(run, call, "skipped", "skipped", { kind: "value", value: null }, "skipped before it started");
  }
  if (!close_call(run, call)) {
    return -1;
  }
  journal_end(run, call.index, hit.status, hit.result);
  patch_agent(run, call.index, { status: hit.status === "skipped" ? "skipped" : "cached", ended_at: now_iso(), preview: preview_of(hit.result) });
  return settle_sandbox(run, call.id, true, JSON.stringify(hit.result ?? null));
};

export const handle_agent_call = (run: LiveWorkflow, item: AgentCall): void => {
  const index = item.id - 1;
  const call: CallState = { index, id: item.id, kind: "agent", settled: false, skip: false, agent_id: null, worktree: null };
  open_call(run, call);
  run.agent_count += 1;
  let plan: AgentPlan | null = null;
  let problem = "";
  try {
    plan = plan_call(run, item);
  } catch (error) {
    problem = error_text(error);
  }
  const label = plan?.label ?? (text_opt(item.opts, "label") || default_label(run));
  const phase = typeof item.opts.phase === "string" ? item.opts.phase : null;
  add_phase(run, phase);
  add_agent(run, {
    index,
    label,
    phase,
    role: plan?.role.name ?? (typeof item.opts.role === "string" ? item.opts.role : "worker"),
    model: plan?.model_id ?? "",
    effort: plan?.effort ?? "",
    status: "starting",
    agent_id: null,
    agent_run_id: null,
    started_at: null,
    ended_at: null,
    worktree: null,
    structured: item.opts.schema !== undefined,
    preview: "",
    error: "",
  });
  const key = plan ? plan_key(plan, item.opts) : call_key(["agent-error", item.prompt, item.opts]);
  append_call(run.run_id, { type: "call", index, kind: "agent", key, label, prompt: item.prompt, opts: item.opts });
  const hit = run.replay.match(index, key);
  if (hit) {
    run.replay.hold(hit.rank)(() => deliver_hit(run, call, hit));
    return;
  }
  if (!plan) {
    finish_call(run, call, "failed", "failed", { kind: "error", text: problem });
    return;
  }
  void start_live(run, call, plan);
};

export const skip_call = (run: LiveWorkflow, index: number): boolean => {
  const call = run.calls.get(index);
  if (!call || call.kind !== "agent" || call.settled) {
    return false;
  }
  call.skip = true;
  const agent = call.agent_id ? get_agent(call.agent_id) : null;
  if (agent) {
    cancel_agent(agent);
  }
  return true;
};

export const stop_calls = (run: LiveWorkflow, error: string, cancel: boolean): number => {
  let stopped = 0;
  for (const call of run.calls.values()) {
    if (!close_call(run, call)) {
      continue;
    }
    journal_end(run, call.index, cancel ? "stopped" : "interrupted", null);
    if (call.kind !== "agent") {
      continue;
    }
    stopped += 1;
    patch_agent(run, call.index, { status: cancel ? "stopped" : "interrupted", ended_at: now_iso(), error });
    const agent = cancel && call.agent_id ? get_agent(call.agent_id) : null;
    if (agent) {
      cancel_agent(agent);
    }
  }
  return stopped;
};

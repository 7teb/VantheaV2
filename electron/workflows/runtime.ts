import { randomUUID } from "node:crypto";
import { workflow_counts, type WorkflowStatus, type WorkflowSummary } from "../../shared/workflow.ts";
import { workflow_notice_text } from "../../shared/workflow-notes.ts";
import { flush_journals_sync } from "../agents/journal.ts";
import { deliver_workflow } from "../agents/reports.ts";
import { error_text } from "../storage/coerce.ts";
import { handle_agent_call, skip_call, stop_calls } from "./calls.ts";
import { handle_workflow_call } from "./children.ts";
import { add_log, add_phase, forget_live_workflow, live_workflow, live_workflows, now_iso, patch_summary, track_live, type LiveWorkflow, type StopReason, type WorkflowContext } from "./live.ts";
import { wrap_body } from "./meta.ts";
import type { HookCall } from "./protocol.ts";
import { app_closed_text, type JournalRecord } from "./records.ts";
import { create_replay } from "./replay.ts";
import { load_roles } from "./roles.ts";
import { open_sandbox, type Sandbox } from "./sandbox.ts";
import type { ScriptSource } from "./saved.ts";
import { add_run, close_calls, get_run, init_workflow_store, remove_chat_runs, result_file, save_interrupted_sync, script_file, user_roles_dir, write_result } from "./store.ts";

export type ArgsValue = { present: boolean; value: unknown };

export type StartInput = {
  context: WorkflowContext;
  source: ScriptSource;
  args: ArgsValue;
  resume: { run_id: string; journal: Map<number, JournalRecord> } | null;
};

export type Started = { summary: WorkflowSummary; start_error: string | null };

type Ending = { value_json: string | null; error: string };

const stop_texts: Record<StopReason, string> = {
  user: "The user stopped the workflow.",
  main: "The main agent stopped the workflow with stop_workflow.",
  chat: "The chat was deleted.",
  app: app_closed_text,
};

const stuck_text =
  "The script is waiting on a promise nothing can settle: every agent() and workflow() call has returned and the script has no code left to run, so it can never finish. Look for an await on a promise that is never resolved, such as a lock, queue or limiter in the script that is never released.";

const summary_of = (run: LiveWorkflow): WorkflowSummary => {
  const stored = get_run(run.run_id);
  if (!stored) {
    throw new Error(`workflow run ${run.run_id} is not in the store`);
  }
  return stored.summary;
};

const notice_for = (summary: WorkflowSummary, value_json: string | null, held: boolean, stopped_by = "the user") => ({
  chat_id: summary.chat_id,
  run_id: summary.run_id,
  name: summary.name,
  status: summary.status,
  held,
  text: workflow_notice_text({ summary, value_json, result_path: value_json === null ? null : result_file(summary.run_id), stopped_by }),
});

const tell_main = (run: LiveWorkflow, value_json: string | null) => {
  if (!run.notify || run.stop_reason === "main" || run.stop_reason === "chat" || run.stop_reason === "app") {
    return;
  }
  deliver_workflow(notice_for(summary_of(run), value_json, run.stop_reason === "user"));
};

const finalize = async (run: LiveWorkflow, value_json: string | null): Promise<void> => {
  try {
    await run.persisted;
    if (run.stop_reason !== "chat" && run.stop_reason !== "app") {
      if (value_json !== null) {
        await write_result(run.run_id, value_json);
      }
      await close_calls(run.run_id);
    }
    tell_main(run, value_json);
  } catch (error) {
    console.error(`[workflows] finishing run ${run.run_id} failed:`, error);
  } finally {
    forget_live_workflow(run.run_id);
    run.finish();
  }
};

const end_run = (run: LiveWorkflow, status: Exclude<WorkflowStatus, "running">, ending: Ending): void => {
  if (run.ended) {
    return;
  }
  run.ended = true;
  try {
    run.sandbox?.terminate().catch((error: unknown) => console.error(`[workflows] terminating the sandbox of ${run.run_id} failed:`, error));
    const why = status === "completed" ? "the script returned while this agent was still running" : ending.error || `the workflow ended ${status}`;
    const stopped = stop_calls(run, why, run.stop_reason !== "app");
    if (status === "completed" && stopped) {
      add_log(run, "note", `${stopped} agent${stopped === 1 ? " was" : "s were"} still running when the script returned and ${stopped === 1 ? "was" : "were"} stopped; their results were never read.`);
    }
    const preview = ending.value_json === null ? "" : ending.value_json.slice(0, 600);
    patch_summary(run, (summary) => Object.assign(summary, { status, ended_at: now_iso(), error: ending.error, result_preview: preview }), true);
    if (run.stop_reason === "app") {
      save_interrupted_sync(run.run_id);
    }
  } finally {
    void finalize(run, ending.value_json);
  }
};

const handle_item = (run: LiveWorkflow, item: HookCall): void => {
  switch (item.kind) {
    case "agent":
      handle_agent_call(run, item);
      return;
    case "workflow":
      handle_workflow_call(run, item);
      return;
    case "phase":
      add_phase(run, item.title);
      return;
    case "log":
      add_log(run, "log", item.text);
      return;
    case "caught":
      add_log(run, "caught", item.text);
      return;
    case "done":
      end_run(run, "completed", { value_json: item.value_json, error: "" });
      return;
    case "failed":
      end_run(run, "failed", { value_json: null, error: item.message });
  }
};

const on_batch = (run: LiveWorkflow, items: HookCall[], ack: number): void => {
  for (const item of items) {
    if (run.ended) {
      return;
    }
    try {
      handle_item(run, item);
    } catch (error) {
      console.error(`[workflows] handling a ${item.kind} call of ${run.run_id} failed:`, error);
      end_run(run, "failed", { value_json: null, error: `the workflow runtime failed on a ${item.kind} call: ${error_text(error)}` });
    }
  }
  if (run.ended) {
    return;
  }
  run.replay.acked(ack);
  if (run.open_calls === 0 && run.sandbox && !run.sandbox.in_flight()) {
    end_run(run, "failed", { value_json: null, error: stuck_text });
  }
};

const new_summary = (run_id: string, input: StartInput): WorkflowSummary => {
  const { meta } = input.source.read;
  return {
    run_id,
    chat_id: input.context.chat_id,
    name: meta.name,
    description: meta.description,
    when_to_use: meta.when_to_use,
    status: "running",
    started_at: now_iso(),
    ended_at: null,
    phases: meta.phases.map((phase) => ({ ...phase })),
    agents: [],
    logs: [],
    script_path: script_file(run_id),
    resumed_from: input.resume?.run_id ?? null,
    result_preview: "",
    error: "",
    parent_message_id: input.context.parent_message_id,
    parent_call_id: input.context.parent_call_id,
    counts: workflow_counts([]),
  };
};

const ended_early = (run: LiveWorkflow): Started => {
  const summary = summary_of(run);
  return { summary, start_error: summary.error || `the workflow ended ${summary.status} before its script ran` };
};

export const start_workflow = async (input: StartInput): Promise<Started> => {
  const run_id = `wf_${randomUUID()}`;
  const { meta, body } = input.source.read;
  const args_text = input.args.present ? (JSON.stringify(input.args.value) ?? "null") : "";
  const summary = new_summary(run_id, input);
  const persisted = add_run({ summary, args_text, notice_due: false }, input.source.text).then(
    () => null,
    (error: unknown) => {
      console.error(`[workflows] saving the new run ${run_id} failed:`, error);
      return `saving the workflow run failed: ${error_text(error)}`;
    },
  );
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const run: LiveWorkflow = {
    run_id,
    context: input.context,
    meta,
    roles: { script: { ...meta.roles }, project: new Map(), user: new Map() },
    sandbox: null,
    replay: create_replay(input.resume?.journal ?? null),
    calls: new Map(),
    open_calls: 0,
    entries: new Map(),
    phase_titles: new Set(summary.phases.map((phase) => phase.title)),
    child_roles: new Map(),
    agent_count: 0,
    next_rank: 0,
    ended: false,
    notify: false,
    stop_reason: null,
    persisted,
    done,
    finish,
  };
  track_live(run);
  const unsaved = await persisted;
  if (unsaved !== null) {
    end_run(run, "failed", { value_json: null, error: unsaved });
    return { summary: summary_of(run), start_error: unsaved };
  }
  if (run.ended) {
    return ended_early(run);
  }
  try {
    run.roles = await load_roles(run.roles.script, input.context.project_root, user_roles_dir());
  } catch (error) {
    console.error(`[workflows] loading the saved roles for ${run_id} failed:`, error);
  }
  if (run.ended) {
    return ended_early(run);
  }
  let sandbox: Sandbox;
  try {
    sandbox = open_sandbox(
      { source: wrap_body(body), filename: `${meta.name}.js`, args_text },
      {
        batch: (items, ack) => on_batch(run, items, ack),
        broken: (message) => end_run(run, "failed", { value_json: null, error: `the sandbox failed: ${message}` }),
      },
    );
  } catch (error) {
    console.error(`[workflows] starting the sandbox of ${run_id} failed:`, error);
    const message = `the sandbox could not start: ${error_text(error)}`;
    end_run(run, "failed", { value_json: null, error: message });
    return { summary: summary_of(run), start_error: message };
  }
  run.sandbox = sandbox;
  const compiled = await sandbox.compiled;
  if (run.ended) {
    return ended_early(run);
  }
  if (compiled.ok) {
    run.notify = true;
    return { summary: summary_of(run), start_error: null };
  }
  end_run(run, "failed", { value_json: null, error: compiled.message });
  return { summary: summary_of(run), start_error: compiled.message };
};

export const stop_workflow_run = (run_id: string, reason: StopReason): boolean => {
  const run = live_workflow(run_id);
  if (!run || run.ended) {
    return false;
  }
  run.stop_reason = reason;
  end_run(run, reason === "app" ? "interrupted" : "stopped", { value_json: null, error: stop_texts[reason] });
  return true;
};

export const skip_workflow_agent = (run_id: string, index: number): boolean => {
  const run = live_workflow(run_id);
  return run !== null && !run.ended && skip_call(run, index);
};

export const stop_chat_workflows = (chat_id: string, reason: StopReason): number =>
  live_workflows().filter((run) => run.context.chat_id === chat_id && stop_workflow_run(run.run_id, reason)).length;

export const settled_workflow = (run_id: string): Promise<void> => live_workflow(run_id)?.done ?? Promise.resolve();

export const clear_chat_workflows = async (chat_id: string): Promise<void> => {
  const owned = live_workflows().filter((run) => run.context.chat_id === chat_id);
  for (const run of owned) {
    stop_workflow_run(run.run_id, "chat");
  }
  await Promise.all(owned.map((run) => run.done));
  await remove_chat_runs(chat_id);
};

export const shutdown_workflows_sync = (): void => {
  for (const run of live_workflows()) {
    stop_workflow_run(run.run_id, "app");
  }
  flush_journals_sync();
};

export const init_workflows = async (dir: string): Promise<void> => {
  for (const run of await init_workflow_store(dir)) {
    deliver_workflow(notice_for(run.summary, null, true));
  }
};

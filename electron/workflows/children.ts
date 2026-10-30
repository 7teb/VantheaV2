import { error_text } from "../storage/coerce.ts";
import { settle_sandbox } from "./calls.ts";
import { add_phase, close_call, journal_end, open_call, type CallState, type LiveWorkflow } from "./live.ts";
import { wrap_body } from "./meta.ts";
import type { HookCall } from "./protocol.ts";
import { call_key } from "./records.ts";
import { path_source, saved_source, type ScriptSource } from "./saved.ts";
import { append_call, user_saved_dir } from "./store.ts";

type WorkflowCall = Extract<HookCall, { kind: "workflow" }>;

type Loaded = { ok: true; source: ScriptSource } | { ok: false; error: string };

const load = async (run: LiveWorkflow, item: WorkflowCall): Promise<Loaded> => {
  try {
    const root = run.context.project_root;
    const source = "name" in item.ref ? await saved_source(root, user_saved_dir(), item.ref.name) : await path_source(root, item.ref.script_path);
    return { ok: true, source };
  } catch (error) {
    return { ok: false, error: `workflow(): ${error_text(error)}` };
  }
};

const deliver = (run: LiveWorkflow, call: CallState, item: WorkflowCall, loaded: Loaded): number => {
  if (!close_call(run, call)) {
    return -1;
  }
  if (!loaded.ok) {
    journal_end(run, call.index, "failed", null);
    return settle_sandbox(run, call.id, false, loaded.error);
  }
  journal_end(run, call.index, "completed", null);
  const { meta, body } = loaded.source.read;
  run.child_roles.set(call.id, meta.roles);
  for (const [name, spec] of Object.entries(meta.roles)) {
    if (!Object.hasOwn(run.roles.script, name)) {
      run.roles.script[name] = spec;
    }
  }
  add_phase(run, `▸ ${meta.name}`, meta.description);
  for (const phase of meta.phases) {
    add_phase(run, `▸ ${meta.name}: ${phase.title}`, phase.detail, phase.model);
  }
  if (!run.sandbox || run.ended) {
    return -1;
  }
  return run.sandbox.child(call.id, wrap_body(body), `${meta.name}.js`, meta.name, item.has_args ? JSON.stringify(item.args) : "");
};

export const handle_workflow_call = (run: LiveWorkflow, item: WorkflowCall): void => {
  const index = item.id - 1;
  const call: CallState = { index, id: item.id, kind: "workflow", settled: false, skip: false, agent_id: null, worktree: null };
  open_call(run, call);
  const key = call_key(["workflow", item.ref, item.has_args ? item.args : null, item.has_args]);
  append_call(run.run_id, { type: "call", index, kind: "workflow", key, ref: item.ref, args: item.has_args ? item.args : null });
  const hit = run.replay.match(index, key);
  const ready = hit ? run.replay.hold(hit.rank) : null;
  void load(run, item).then((loaded) => {
    if (ready) {
      ready(() => deliver(run, call, item, loaded));
      return;
    }
    deliver(run, call, item, loaded);
  });
};

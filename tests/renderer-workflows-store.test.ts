import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { WorkflowSummary } from "../shared/workflow.ts";
import { begin_list, empty_workflows, fail_list, finish_list, holds_turn, list_status, live_run, newer_summary, receive_summary, run_status, summary_progress } from "../src/state/workflows-reduce.ts";
import { bundle, install_dom, type Vx } from "./dom-kit.ts";
import { agent_entry, run_id, summary_of } from "./workflow-ui-kit.ts";

const other = (summary: WorkflowSummary, id: string): WorkflowSummary => ({ ...summary, run_id: id });

test("progress grows with agents, their stage, log lines and phases", () => {
  const base = summary_of("running", [agent_entry(0, "starting")]);
  const ran = summary_of("running", [agent_entry(0, "running")]);
  const ended = summary_of("running", [agent_entry(0, "completed")]);
  assert.ok(summary_progress(base) < summary_progress(ran));
  assert.ok(summary_progress(ran) < summary_progress(ended));
  assert.ok(summary_progress(ended) < summary_progress({ ...ended, logs: [{ at: "x", kind: "log", text: "found 3" }] }));
  assert.ok(summary_progress(ended) < summary_progress({ ...ended, phases: [{ title: "Review", detail: "", model: "" }] }));
});

test("an ended run never goes back to running and a running run never loses progress", () => {
  const early = summary_of("running", [agent_entry(0, "running")]);
  const later = summary_of("running", [agent_entry(0, "completed"), agent_entry(1, "running")]);
  const done = summary_of("completed", [agent_entry(0, "completed"), agent_entry(1, "completed")]);
  assert.equal(newer_summary(done, later), done);
  assert.equal(newer_summary(later, done), done);
  assert.equal(newer_summary(later, early), later);
  assert.equal(newer_summary(early, later), later);
  const same = { ...early, agents: [agent_entry(0, "running", { preview: "new" })] };
  assert.equal(newer_summary(early, same), same);
  const interrupted = { ...done, status: "interrupted" as const };
  assert.equal(newer_summary(done, interrupted), interrupted);
});

test("a list for a new chat loads, holds events and merges them by progress", () => {
  const loading = begin_list(empty_workflows, "c1", 1);
  assert.deepEqual([loading.chat_id, loading.status, loading.pending, Object.keys(loading.runs)], ["c1", "loading", true, []]);
  const early = summary_of("running", [agent_entry(0, "running")]);
  const live = receive_summary(loading, early);
  assert.equal(live.runs[run_id], early);
  assert.deepEqual(live.held, [early]);
  const snapshot = summary_of("running", [agent_entry(0, "completed"), agent_entry(1, "running")]);
  const second = other(summary_of("completed", []), "wf_second");
  const ready = finish_list(live, 1, [snapshot, second, { ...second, run_id: "wf_foreign", chat_id: "c2" }]);
  assert.equal(ready.status, "ready");
  assert.equal(ready.pending, false);
  assert.deepEqual(ready.held, []);
  assert.equal(ready.runs[run_id], snapshot);
  assert.equal(ready.runs.wf_second, second);
  assert.equal(ready.runs.wf_foreign, undefined);
  const ended = summary_of("completed", snapshot.agents);
  const after_end = receive_summary(ready, ended);
  assert.equal(after_end.runs[run_id], ended);
  assert.deepEqual(after_end.held, []);
  assert.equal(receive_summary(after_end, snapshot), after_end);
});

test("an event that ended the run while the list was loading survives an older snapshot", () => {
  const loading = begin_list(empty_workflows, "c1", 4);
  const ended = summary_of("stopped", [agent_entry(0, "stopped")]);
  const held = receive_summary(loading, ended);
  const ready = finish_list(held, 4, [summary_of("running", [agent_entry(0, "running")])]);
  assert.equal(ready.runs[run_id], ended);
});

test("a late answer of an older request is ignored after the chat changed back", () => {
  let state = begin_list(empty_workflows, "c1", 1);
  state = begin_list(state, "c2", 2);
  state = begin_list(state, "c1", 3);
  const stale = finish_list(state, 1, [summary_of("running", [])]);
  assert.equal(stale, state);
  const fresh = finish_list(state, 3, [summary_of("completed", [])]);
  assert.equal(fresh.runs[run_id]?.status, "completed");
  assert.equal(finish_list(fresh, 2, []), fresh);
  assert.equal(fail_list(fresh, 3), fresh);
});

test("events of other chats only update the remembered status and a cleared chat drops every run", () => {
  const ready = finish_list(begin_list(empty_workflows, "c1", 1), 1, []);
  const foreign = { ...summary_of("running", []), chat_id: "c2" };
  const noted = receive_summary(ready, foreign);
  assert.deepEqual([noted.runs, noted.held, noted.known], [{}, [], { [run_id]: "running" }]);
  assert.equal(receive_summary(noted, foreign), noted);
  const cleared = begin_list(receive_summary(ready, summary_of("running", [])), null, 2);
  assert.deepEqual([cleared.chat_id, cleared.status, Object.keys(cleared.runs), cleared.request], [null, "idle", [], 2]);
  assert.equal(receive_summary(cleared, summary_of("running", [])), cleared);
});

test("a failed first list keeps the runs that arrived as events, a failed reload keeps the ready list", () => {
  const loading = receive_summary(begin_list(empty_workflows, "c1", 1), summary_of("running", []));
  const failed = fail_list(loading, 1);
  assert.deepEqual([failed.status, failed.pending, Object.keys(failed.runs)], ["failed", false, [run_id]]);
  const ready = finish_list(begin_list(empty_workflows, "c1", 2), 2, [summary_of("completed", [])]);
  const reloading = begin_list(ready, "c1", 3);
  assert.deepEqual([reloading.status, reloading.pending, Object.keys(reloading.runs)], ["ready", true, [run_id]]);
  const kept = fail_list(reloading, 3);
  assert.deepEqual([kept.status, kept.pending, kept.runs[run_id]?.status], ["ready", false, "completed"]);
});

test("list status and the live run answer for the asked chat and run ids only", () => {
  const ready = finish_list(begin_list(empty_workflows, "c1", 1), 1, [summary_of("running", []), other(summary_of("completed", []), "wf_done")]);
  assert.equal(list_status(ready, "c1"), "ready");
  assert.equal(list_status(ready, "c2"), "loading");
  assert.equal(live_run(ready, ["wf_done", run_id])?.run_id, run_id);
  assert.equal(live_run(ready, ["wf_done", "wf_missing"]), null);
  assert.equal(live_run(ready, []), null);
});

test("run statuses are remembered across chats so a turn keeps waiting right after a chat switch", () => {
  const foreign = { ...summary_of("running", []), run_id: "wf_c2", chat_id: "c2" };
  let state = finish_list(begin_list(empty_workflows, "c1", 1), 1, [summary_of("running", [])]);
  state = receive_summary(state, foreign);
  assert.equal(state.runs.wf_c2, undefined);
  assert.deepEqual(state.known, { [run_id]: "running", wf_c2: "running" });
  state = begin_list(state, "c2", 2);
  assert.equal(state.status, "loading");
  assert.equal(run_status(state, "wf_c2"), "running");
  assert.equal(holds_turn(state, ["wf_c2"]), true);
  state = receive_summary(state, { ...summary_of("completed", []), chat_id: "c1" });
  assert.equal(run_status(state, run_id), "completed");
  state = receive_summary(state, { ...summary_of("running", []), chat_id: "c1" });
  assert.equal(run_status(state, run_id), "completed");
  state = finish_list(state, 2, [{ ...foreign, status: "stopped", ended_at: foreign.started_at }]);
  assert.equal(run_status(state, "wf_c2"), "stopped");
  assert.equal(holds_turn(state, ["wf_c2", run_id]), false);
  assert.equal(holds_turn(state, ["wf_unknown"]), false);
  assert.equal(run_status(state, "wf_unknown"), null);
  assert.deepEqual(begin_list(state, null, 3).known, state.known);
});

type Deferred = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let client: any;
let restore = () => {};
const calls: [string, unknown[]][] = [];
const waiting: Deferred[] = [];
const listeners = new Map<string, ((payload: unknown) => void)[]>();
let failing = false;

const vx: Vx = {
  invoke: (name, ...args) => {
    calls.push([name, args]);
    if (name === "workflows:list") {
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    }
    return failing ? Promise.reject(new Error(`${name} refused`)) : Promise.resolve(undefined);
  },
  on: (name, listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return () => listeners.set(name, (listeners.get(name) ?? []).filter((entry) => entry !== listener));
  },
  send: () => {},
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

before(async () => {
  restore = install_dom(vx).restore;
  client = await bundle(['export * from "./src/state/workflows.ts";', 'export { ui_store } from "./src/state/ui.ts";'], []);
});

after(() => restore());

test("the store loads the active chat, follows chat switches and ignores the stale answer", async () => {
  const stop = client.init_workflows();
  const choose = (chat_id: string | null) => client.ui_store.update((state: any) => ({ ...state, active_chat_id: chat_id }));
  choose("c1");
  choose("c2");
  choose("c1");
  await settle();
  const lists = calls.filter(([name]) => name === "workflows:list").map(([, args]) => args[0]);
  assert.deepEqual(lists.slice(-3), ["c1", "c2", "c1"]);
  const [first, second, third] = waiting.splice(-3);
  const changed = listeners.get("workflows:changed")?.[0];
  assert.ok(changed);
  changed(summary_of("running", [agent_entry(0, "running")]));
  third?.resolve([summary_of("running", [agent_entry(0, "completed")])]);
  first?.resolve([summary_of("running", [])]);
  second?.resolve([{ ...summary_of("running", []), chat_id: "c2" }]);
  await settle();
  const state = client.workflows_store.get();
  assert.equal(state.chat_id, "c1");
  assert.equal(state.status, "ready");
  assert.equal(state.runs[run_id].agents[0].status, "completed");
  stop();
  assert.equal(listeners.get("workflows:changed")?.length, 0);
});

test("stop and skip call their channels and report a refused call", async () => {
  calls.length = 0;
  assert.deepEqual(await client.stop_workflow(run_id), { ok: true });
  assert.deepEqual(await client.skip_workflow_agent(run_id, 3), { ok: true });
  assert.deepEqual(calls, [
    ["workflows:stop", [run_id]],
    ["workflows:skip_agent", [run_id, 3]],
  ]);
  failing = true;
  const logged = mock.method(console, "error", () => {});
  try {
    assert.deepEqual(await client.stop_workflow(run_id), { ok: false, error: "workflows:stop refused" });
    assert.deepEqual(await client.skip_workflow_agent(run_id, 1), { ok: false, error: "workflows:skip_agent refused" });
    assert.equal(logged.mock.callCount(), 2);
    assert.match(String(logged.mock.calls[1]?.arguments[0]), /skip_agent failed for run wf_.* agent 1/);
  } finally {
    logged.mock.restore();
    failing = false;
  }
});

test("a list that fails is logged and marks the chat failed", async () => {
  const logged = mock.method(console, "error", () => {});
  try {
    const loading = client.load_workflows("c9");
    waiting.pop()?.reject(new Error("main process busy"));
    await loading;
    assert.equal(client.workflows_store.get().status, "failed");
    assert.match(String(logged.mock.calls[0]?.arguments[0]), /workflows:list failed for chat c9/);
  } finally {
    logged.mock.restore();
  }
});

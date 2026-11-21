import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

const stubs: Record<string, string> = {
  handle: [
    "export const taps = new Set();",
    "export const add_event_tap = (tap) => { taps.add(tap); return () => { taps.delete(tap); }; };",
    "export const fire = () => { for (const tap of [...taps]) tap(null, 'agents:changed', null); };",
  ].join("\n"),
  run: [
    "export const starts = [];",
    "let next = null;",
    "export const set_next_start = (fn) => { next = fn; };",
    "export const start_internal_turn = (chat_id, origin, text) => { starts.push({ chat_id, origin, text }); return next ? next(chat_id) : Promise.resolve(null); };",
  ].join("\n"),
  manager: "export const tasks = []; export const list_background = (chat_id) => tasks.filter((task) => task.chat_id === chat_id); export const result_was_read = () => false;",
  agents_live: "export const lives = []; export const live_runs = () => [...lives];",
  workflows_live: "export const flows = []; export const live_workflows = () => [...flows];",
  agents_store: "export const running_in_chat = () => 0;",
  workflows_store: "export const running_workflows_in_chat = () => 0;",
};

const routes: [RegExp, string][] = [
  [/[\\/]ipc[\\/]handle\.ts$/, "handle"],
  [/[\\/]turn[\\/]run\.ts$/, "run"],
  [/[\\/]background[\\/]manager\.ts$/, "manager"],
  [/[\\/]agents[\\/]live\.ts$/, "agents_live"],
  [/[\\/]workflows[\\/]live\.ts$/, "workflows_live"],
  [/[\\/]agents[\\/]store\.ts$/, "agents_store"],
  [/[\\/]workflows[\\/]store\.ts$/, "workflows_store"],
];

const idle_stubs: Plugin = {
  name: "idle-stubs",
  setup(builder) {
    builder.onResolve({ filter: /\.ts$/ }, (args) => {
      const target = path.resolve(args.resolveDir, args.path);
      const name = routes.find(([filter]) => filter.test(target))?.[1];
      return name ? { path: name, namespace: "stub" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

let vx: any;

const tick = () => new Promise((resolve) => setImmediate(resolve));

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const tracked = (promise: Promise<void>) => {
  const state = { settled: false, error: null as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
};

const report = (chat_id: string, run_id: string) => ({
  chat_id,
  agent_id: `agent_${run_id}`,
  run_id,
  name: "Reviewer",
  profile: "worker",
  model: "test/model",
  status: "completed",
  started_at: "2026-11-20T10:00:00.000Z",
  ended_at: "2026-11-20T10:00:05.000Z",
  report_path: null,
  stop_reason: "",
});

const zero = { turn: false, agents: 0, workflows: 0, background: 0, queued: 0 };

before(async () => {
  const result = await build({
    stdin: {
      contents: [
        'export { chat_activity, chat_idle, when_idle } from "./electron/app/idle.ts";',
        'export { drop_pending_events, notify_agent, pending_event_count } from "./electron/app/notifications.ts";',
        'export { deliver_report, deliver_workflow, drop_agent_notes, has_agent_notes, has_due_agent_notes, hold_update, set_agent_continuation } from "./electron/agents/reports.ts";',
        'export { forget_user_stop, mark_user_stop, release_chat, reserve_chat } from "./electron/turn/active.ts";',
        'export { fire, taps } from "./electron/ipc/handle.ts";',
        'export { set_next_start, starts } from "./electron/turn/run.ts";',
        'export { tasks } from "./electron/background/manager.ts";',
        'export { lives } from "./electron/agents/live.ts";',
        'export { flows } from "./electron/workflows/live.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [idle_stubs],
    logLevel: "silent",
  });
  vx = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  vx.set_agent_continuation(vx.notify_agent);
});

test("chat_activity counts the turn, live agents and workflows, running background tasks and queued follow-ups", async () => {
  const chat_id = "c1";
  assert.deepEqual(vx.chat_activity(chat_id), zero);
  assert.equal(vx.chat_idle(chat_id), true);
  vx.reserve_chat(chat_id);
  assert.deepEqual(vx.chat_activity(chat_id), { ...zero, turn: true });
  assert.equal(vx.chat_idle(chat_id), false);
  vx.release_chat(chat_id);
  const never = new Promise<void>(() => {});
  vx.lives.push({ chat_id, done: never }, { chat_id: "other", done: never });
  vx.flows.push({ context: { chat_id }, done: never });
  vx.tasks.push({ chat_id, status: "running" }, { chat_id, status: "completed" }, { chat_id: "other", status: "running" });
  assert.deepEqual(vx.chat_activity(chat_id), { ...zero, agents: 1, workflows: 1, background: 1 });
  assert.equal(vx.chat_idle(chat_id), false);
  vx.lives.length = 0;
  vx.flows.length = 0;
  vx.tasks.length = 0;
  const gate = deferred<null>();
  vx.set_next_start(() => gate.promise);
  vx.notify_agent({ kind: "report", report: report(chat_id, "run_1") });
  assert.equal(vx.pending_event_count(chat_id), 2);
  assert.deepEqual(vx.chat_activity(chat_id), { ...zero, queued: 2 });
  gate.resolve(null);
  await tick();
  assert.equal(vx.pending_event_count(chat_id), 1);
  assert.equal(vx.chat_idle(chat_id), false);
  vx.set_next_start(null);
  vx.drop_pending_events(chat_id);
  assert.equal(vx.pending_event_count(chat_id), 0);
  assert.equal(vx.chat_idle(chat_id), true);
});

test("agent notes count while they would start a follow-up and not while they wait for the next turn", () => {
  const chat_id = "c2";
  vx.reserve_chat(chat_id);
  vx.deliver_report(report(chat_id, "run_2"));
  vx.release_chat(chat_id);
  assert.equal(vx.has_due_agent_notes(chat_id), true);
  assert.deepEqual(vx.chat_activity(chat_id), { ...zero, queued: 1 });
  vx.drop_agent_notes(chat_id);
  vx.mark_user_stop(chat_id);
  vx.hold_update({ chat_id, agent_id: "agent_run_3", run_id: "run_3", name: "Reviewer", text: "half way" });
  vx.deliver_workflow({ chat_id, run_id: "wf_1", name: "build", status: "stopped", text: "stopped", held: true });
  assert.equal(vx.has_agent_notes(chat_id), true);
  assert.equal(vx.has_due_agent_notes(chat_id), false);
  assert.equal(vx.chat_idle(chat_id), true);
  vx.forget_user_stop(chat_id);
  assert.equal(vx.has_due_agent_notes(chat_id), true);
  vx.drop_agent_notes(chat_id);
  assert.equal(vx.chat_idle(chat_id), true);
});

test("when_idle resolves at once for an idle chat and when the turn ends otherwise", async () => {
  await vx.when_idle("c3", new AbortController().signal);
  assert.equal(vx.taps.size, 0);
  vx.reserve_chat("c3");
  const state = tracked(vx.when_idle("c3", new AbortController().signal));
  vx.fire();
  await tick();
  assert.equal(state.settled, false);
  vx.release_chat("c3");
  await tick();
  assert.deepEqual(state, { settled: true, error: null });
  assert.equal(vx.taps.size, 0);
});

test("when_idle re-checks on tapped events and when agent or workflow work ends", async () => {
  const chat_id = "c4";
  const task = { chat_id, status: "running" };
  vx.tasks.push(task);
  const by_event = tracked(vx.when_idle(chat_id, new AbortController().signal));
  await tick();
  assert.equal(by_event.settled, false);
  task.status = "completed";
  vx.fire();
  await tick();
  assert.equal(by_event.settled, true);
  vx.tasks.length = 0;
  const agent_done = deferred<void>();
  const flow_done = deferred<void>();
  const agent = { chat_id, done: agent_done.promise };
  const flow = { context: { chat_id }, done: flow_done.promise };
  vx.lives.push(agent);
  vx.flows.push(flow);
  const by_done = tracked(vx.when_idle(chat_id, new AbortController().signal));
  vx.lives.splice(vx.lives.indexOf(agent), 1);
  agent_done.resolve();
  await tick();
  assert.equal(by_done.settled, false);
  vx.flows.splice(vx.flows.indexOf(flow), 1);
  flow_done.resolve();
  await tick();
  assert.deepEqual(by_done, { settled: true, error: null });
});

test("a finishing agent never looks idle between its status change and its queued report", async () => {
  const chat_id = "c5";
  const done = deferred<void>();
  const agent = { chat_id, done: done.promise };
  vx.lives.push(agent);
  const state = tracked(vx.when_idle(chat_id, new AbortController().signal));
  vx.fire();
  assert.equal(vx.chat_idle(chat_id), false);
  const gate = deferred<{ user_message_id: string; message_id: string }>();
  vx.set_next_start((id: string) => {
    vx.reserve_chat(id);
    return gate.promise;
  });
  vx.lives.splice(vx.lives.indexOf(agent), 1);
  vx.deliver_report(report(chat_id, "run_5"));
  done.resolve();
  await tick();
  assert.equal(state.settled, false);
  assert.deepEqual(vx.chat_activity(chat_id), { ...zero, turn: true, queued: 2 });
  gate.resolve({ user_message_id: "u", message_id: "m" });
  await tick();
  assert.equal(state.settled, false);
  assert.equal(vx.pending_event_count(chat_id), 0);
  vx.release_chat(chat_id);
  await tick();
  assert.deepEqual(state, { settled: true, error: null });
  vx.set_next_start(null);
});

test("a background task that ends and queues its follow-up in one call stack does not settle when_idle", async () => {
  const chat_id = "c6";
  const task = { chat_id, status: "running" };
  vx.tasks.push(task);
  const state = tracked(vx.when_idle(chat_id, new AbortController().signal));
  const gate = deferred<{ user_message_id: string; message_id: string }>();
  vx.set_next_start((id: string) => {
    vx.reserve_chat(id);
    return gate.promise;
  });
  task.status = "completed";
  vx.fire();
  vx.notify_agent({ kind: "report", report: report(chat_id, "run_6") });
  await tick();
  assert.equal(state.settled, false);
  gate.resolve({ user_message_id: "u", message_id: "m" });
  await tick();
  vx.release_chat(chat_id);
  await tick();
  assert.deepEqual(state, { settled: true, error: null });
  vx.set_next_start(null);
  vx.tasks.length = 0;
});

test("when_idle rejects on abort and removes its listeners on every path", async () => {
  vx.reserve_chat("c7");
  const controller = new AbortController();
  const state = tracked(vx.when_idle("c7", controller.signal));
  assert.equal(vx.taps.size, 1);
  controller.abort();
  await tick();
  assert.equal(state.settled, true);
  assert.equal((state.error as Error).name, "AbortError");
  assert.equal(vx.taps.size, 0);
  await assert.rejects(vx.when_idle("c7", controller.signal), { name: "AbortError" });
  assert.equal(vx.taps.size, 0);
  vx.release_chat("c7");
});

test("a failing agent end is logged and still re-checks", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  const done = deferred<void>();
  const agent = { chat_id: "c8", done: done.promise };
  vx.lives.push(agent);
  const state = tracked(vx.when_idle("c8", new AbortController().signal));
  vx.lives.splice(vx.lives.indexOf(agent), 1);
  done.reject(new Error("finish broke"));
  await tick();
  assert.deepEqual(state, { settled: true, error: null });
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0]?.arguments[0]), /chat c8/);
});

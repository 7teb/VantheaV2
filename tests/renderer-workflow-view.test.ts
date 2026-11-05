import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { NoticeStep, UserMessage } from "../shared/chat.ts";
import type { WorkflowSummary } from "../shared/workflow.ts";
import { workflow_notice_text } from "../shared/workflow-notes.ts";
import { bundle, FakeElement, install_dom, stub_components, type Vx } from "./dom-kit.ts";
import { agent_entry, at, run_id, summary_of, tool_step, workflow_tool_view } from "./workflow-ui-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};
const calls: [string, unknown[]][] = [];

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push([name, args]);
    return name === "agents:run" ? null : undefined;
  },
  on: () => () => {},
  send: () => {},
};

const stubs: Record<string, string> = {
  DotSpinner: 'import { createElement } from "react"; export const DotSpinner = () => createElement("span", { className: "dot-spinner" });',
};

const with_class = (name: string, scope: FakeElement = container) => scope.matching((element) => element.className.split(" ").includes(name));

const text_of = (name: string, scope: FakeElement = container) => with_class(name, scope).map((element) => element.textContent);

const one = (name: string, scope: FakeElement = container) => {
  const found = with_class(name, scope);
  assert.equal(found.length, 1, `exactly one .${name}`);
  return found[0] as FakeElement;
};

const press = (element: FakeElement) => {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
  assert.ok(key);
  const props = (element as unknown as Record<string, { onClick: (event: unknown) => void }>)[key];
  client.flushSync(() => props.onClick({ currentTarget: element }));
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const show = (element: unknown) => client.flushSync(() => root.render(element));

const clear = () => show(null);

const store_with = (summaries: WorkflowSummary[], status: "loading" | "ready" | "failed" = "ready", known: Record<string, string> = {}) =>
  client.flushSync(() =>
    client.workflows_store.set({ chat_id: "c1", status, request: 1, pending: status === "loading", runs: Object.fromEntries(summaries.map((summary) => [summary.run_id, summary])), held: [], known, open: null }),
  );

const row = (status = "running" as const) => client.createElement(client.WorkflowRow, { chat_id: "c1", view: workflow_tool_view(status) });

const now = Date.parse(at(75));

const live_summary = () =>
  summary_of(
    "running",
    [
      agent_entry(0, "completed", { phase: "Review", label: "review:bugs", role: "explore" }),
      agent_entry(1, "running", { phase: "Review", label: "review:perf", role: "explore" }),
      agent_entry(2, "starting", { phase: "Verify", label: "verify:a.ts", role: "skeptic", agent_run_id: null }),
      agent_entry(3, "cached", { phase: "Verify", label: "verify:b.ts", role: "skeptic" }),
    ],
    {
      phases: [{ title: "Review", detail: "one agent per dimension", model: "" }, { title: "Verify", detail: "", model: "" }],
      logs: [
        { at: at(1), kind: "log", text: "Reviewing 2 dimensions" },
        { at: at(2), kind: "caught", text: "parallel: TypeError: x is undefined" },
      ],
    },
  );

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  Object.assign(Reflect.get(globalThis, "window") as object, { setInterval, clearInterval });
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { WorkflowRow } from "./src/features/tools/WorkflowRow.tsx";',
      'export { WorkflowPanel } from "./src/features/docks/background/WorkflowPanel.tsx";',
      'export { WorkGroup } from "./src/features/tools/WorkGroup.tsx";',
      'export { NoticeRow } from "./src/features/chat/StepRows.tsx";',
      'export { OriginNote } from "./src/features/chat/OriginNote.tsx";',
      'export { ApprovalDetail } from "./src/features/tools/ApprovalDetail.tsx";',
      'export { workflows_store } from "./src/state/workflows.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
    ],
    [stub_components("WorkGroup.tsx", stubs)],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

const panel = (summary: WorkflowSummary | null, failed = false) => client.createElement(client.WorkflowPanel, { summary, failed, now });

const header = () => one("dock-header");

test("a workflow is one compact row in the chat, and a click opens its run in Background Tasks", () => {
  mock.timers.enable({ apis: ["Date"], now });
  try {
    client.ui_store.update((state: any) => ({ ...state, active_chat_id: "c1", dock: { ...state.dock, kind: null } }));
    store_with([live_summary()]);
    show(row());
    const head = one("tool-row-head");
    assert.equal(head.hasAttribute("aria-expanded"), false);
    assert.equal(head.hasAttribute("disabled"), false);
    assert.equal(head.getAttribute("title"), "Review changed files and verify each finding\nShow in Background Tasks");
    assert.equal(one("tool-row-label", head).textContent, "Running workflow review-changes");
    assert.ok(one("tool-row-label", head).className.includes("is-working"));
    assert.equal(one("tool-row-detail", head).textContent, "2/4 agents");
    assert.equal(one("tool-row-elapsed", head).textContent, "1m 15s");
    assert.equal(with_class("workflow-view").length, 0);
    assert.equal(with_class("tool-row-chevron").length, 0);
    press(head);
    assert.equal(client.workflows_store.get().open, run_id);
    assert.equal(client.ui_store.get().dock.kind, "background");
  } finally {
    clear();
    mock.timers.reset();
  }
});

test("the workflow panel shows the run's state, log lines, phases with their agents and Stop", async () => {
  mock.timers.enable({ apis: ["Date"], now });
  try {
    store_with([live_summary()]);
    show(panel(live_summary()));
    assert.equal(one("dock-title-meta").textContent, "Running · 2/4 agents · 1m 15s");
    assert.deepEqual(text_of("workflow-log"), ["Reviewing 2 dimensions", "parallel: TypeError: x is undefined"]);
    assert.deepEqual(with_class("workflow-log").map((line) => line.getAttribute("data-kind")), ["log", "caught"]);
    assert.deepEqual(text_of("workflow-phase-title"), ["Review", "Verify"]);
    assert.deepEqual(text_of("workflow-phase-count"), ["1/2", "1/2"]);
    assert.deepEqual(text_of("workflow-phase-detail"), ["one agent per dimension"]);
    assert.deepEqual(text_of("workflow-agent-label"), ["review:bugs", "review:perf", "verify:a.ts", "verify:b.ts"]);
    assert.deepEqual(text_of("workflow-agent-meta"), ["Explore · 10s", "Explore · 1m 14s", "skeptic · Starting · 1m 13s", "skeptic · Cached"]);
    assert.equal(one("workflow-foot-lead").textContent, "2 running, 1 completed, 1 cached");
    assert.equal(with_class("workflow-end").length, 0);
    assert.equal(with_class("workflow-result").length, 0);
    const agents = with_class("workflow-agent");
    assert.deepEqual(agents.map((agent) => with_class("workflow-agent-skip", agent).length), [0, 1, 1, 0]);
    calls.length = 0;
    press(one("workflow-agent-skip", agents[1] as FakeElement));
    press(one("button-ghost", header()));
    await settle();
    assert.deepEqual(calls, [
      ["workflows:skip_agent", [run_id, 1]],
      ["workflows:stop", [run_id]],
    ]);
    client.workflows_store.update((state: any) => ({ ...state, open: run_id }));
    const back = header().matching((element) => element.getAttribute("aria-label") === "Back to background tasks");
    assert.equal(back.length, 1);
    press(back[0] as FakeElement);
    assert.equal(client.workflows_store.get().open, null);
  } finally {
    clear();
    mock.timers.reset();
  }
});

test("a started agent opens its transcript in the dock, a cached or unstarted one cannot", async () => {
  client.ui_store.update((state: any) => ({ ...state, active_chat_id: "c1", dock: { ...state.dock, kind: null } }));
  store_with([live_summary()]);
  show(panel(live_summary()));
  const mains = with_class("workflow-agent-main");
  assert.deepEqual(mains.map((main) => main.hasAttribute("disabled")), [false, false, true, true]);
  calls.length = 0;
  press(mains[1] as FakeElement);
  await settle();
  assert.deepEqual(calls, [["agents:run", ["agent_1", "run_1"]]]);
  assert.equal(client.ui_store.get().dock.kind, "background");
  assert.equal(mains[1]?.getAttribute("title"), "review:perf\ntest/model · high");
  clear();
});

test("a finished workflow names its end in the row and shows the return value in the panel, without Stop or Skip", () => {
  const done = summary_of("completed", [agent_entry(0, "completed"), agent_entry(1, "cached")], { result_preview: '{"confirmed":[]}' });
  store_with([done]);
  show(row());
  const head = one("tool-row-head");
  assert.equal(one("tool-row-label", head).textContent, "Ran workflow review-changes");
  assert.equal(one("tool-row-label", head).className.includes("is-working"), false);
  assert.equal(one("tool-row-detail", head).textContent, "2 agents");
  assert.equal(one("tool-row-duration", head).textContent, "5m 12s");
  clear();
  show(panel(done));
  assert.equal(one("workflow-result-head").textContent, "Return value");
  assert.equal(one("workflow-result-text").textContent, '{"confirmed":[]}');
  assert.equal(one("workflow-end").textContent, "Completed");
  assert.equal(one("workflow-foot-lead").textContent, "1 completed, 1 cached");
  assert.equal(with_class("button-ghost", header()).length, 0);
  assert.equal(with_class("workflow-agent-skip").length, 0);
  clear();
});

test("a failed or stopped workflow marks the row and shows why in the panel", () => {
  const failed = summary_of("failed", [agent_entry(0, "failed", { error: "provider error 500" })], { error: "TypeError: findings is not iterable (script line 12)" });
  store_with([failed]);
  show(row());
  assert.equal(one("workflow-row").getAttribute("data-status"), "failed");
  assert.equal(one("tool-row-label").textContent, "Workflow review-changes failed");
  clear();
  show(panel(failed));
  assert.equal(one("workflow-message").textContent, "TypeError: findings is not iterable (script line 12)");
  assert.equal(one("workflow-message").getAttribute("data-tone"), "error");
  assert.equal(one("workflow-agent-error").textContent, "provider error 500");
  assert.equal(one("workflow-end").getAttribute("data-status"), "failed");
  clear();
  const stopped = summary_of("stopped", [agent_entry(0, "stopped", { error: "The workflow was stopped." })], { error: "Stopped from the chat." });
  store_with([stopped]);
  show(row());
  assert.equal(one("workflow-row").getAttribute("data-status"), "cancelled");
  assert.equal(one("tool-row-label").textContent, "Stopped workflow review-changes");
  clear();
  show(panel(stopped));
  assert.equal(one("workflow-message").getAttribute("data-tone"), "muted");
  assert.equal(one("workflow-end").textContent, "Stopped");
  clear();
});

test("while the list loads the panel shows a skeleton, a failed list says so and a run that is gone leaves a plain row", () => {
  show(panel(null));
  assert.equal(one("workflow-view").getAttribute("aria-busy"), "true");
  assert.ok(with_class("skeleton").length >= 3);
  clear();
  show(panel(null, true));
  assert.equal(one("dock-empty").textContent, "Workflow progress could not be loaded");
  clear();
  store_with([], "loading", { [run_id]: "running" });
  show(row());
  assert.equal(one("tool-row-label").textContent, "Running workflow review-changes");
  assert.equal(one("tool-row-head").hasAttribute("disabled"), false);
  clear();
  store_with([], "ready");
  show(row());
  assert.equal(one("tool-row-head").hasAttribute("disabled"), true);
  assert.equal(one("tool-row-label").textContent, "Ran workflow review-changes");
  clear();
});

test("a tool group with a running workflow names it in its head but stays closed until the user opens it", () => {
  const steps = [tool_step("read_file", null, "done", { path: "a.ts" }, "r1"), tool_step("run_workflow", workflow_tool_view(), "done", {}, "w1")];
  const group = () => client.createElement(client.WorkGroup, { chat_id: "c1", steps, streaming: false, tail: true });
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
  Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  try {
    store_with([live_summary()]);
    show(group());
    const head = one("work-group-head");
    assert.equal(one("work-group").getAttribute("data-open"), "false");
    assert.equal(one("work-group").getAttribute("data-running"), "true");
    assert.equal(one("tool-row-label", head).textContent, "Running workflow review-changes");
    assert.equal(one("tool-row-elapsed", head).textContent, "1m 15s");
    assert.equal(with_class("dot-spinner", head).length, 1);
    client.flushSync(() => mock.timers.tick(700));
    store_with([summary_of("completed", [agent_entry(0, "completed")])]);
    client.flushSync(() => mock.timers.tick(700));
    assert.equal(one("work-group").hasAttribute("data-running"), false);
    assert.equal(one("tool-row-label", head).textContent, "Read 1 file, ran 1 workflow");
    press(one("work-group-head"));
    assert.equal(one("work-group").getAttribute("data-open"), "true");
  } finally {
    clear();
    mock.timers.reset();
    Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  }
});

const notice = (name: string, status: "completed" | "stopped" | "failed") =>
  workflow_notice_text({
    summary: summary_of(status, [agent_entry(0, "completed")], { name, run_id: `wf_${name}-0000`, error: status === "failed" ? "boom" : "" }),
    value_json: "{}",
    result_path: "C:/r.json",
    stopped_by: "the user",
  });

test("workflow results show as one row per workflow with its end state, in a turn and as an origin message", () => {
  const step: NoticeStep = { id: "n1", round: 1, kind: "notice", notice: "workflow_result", text: notice("audit", "stopped") };
  show(client.createElement(client.NoticeRow, { step }));
  assert.equal(one("tool-row-label").textContent, "Result of workflow audit");
  assert.equal(one("tool-row-status").textContent, "Stopped");
  assert.equal(with_class("notice-row").length, 0);
  clear();
  const message: UserMessage = { id: "u1", role: "user", text: `${notice("first", "completed")}\n\n${notice("second", "failed")}`, attachments: [], origin: "workflow", created_at: at(0) };
  show(client.createElement(client.OriginNote, { message }));
  assert.deepEqual(text_of("tool-row-label"), ["Result of workflow first", "Result of workflow second"]);
  assert.deepEqual(text_of("tool-row-status"), ["Failed"]);
  assert.ok(one("tool-row-status").className.includes("is-failed"));
  clear();
  show(client.createElement(client.OriginNote, { message: { ...message, text: "unreadable" } }));
  assert.equal(one("origin-note").textContent, "Workflow result");
  clear();
});

test("the run_workflow approval shows the description, the script and the args as code", () => {
  const request: ApprovalRequest = {
    kind: "agent_message",
    tool: "run_workflow",
    to_name: "review-changes",
    to_id: null,
    about: "Review changed files",
    text: "export const meta = { name: 'review-changes', description: 'Review changed files' }\nreturn 1\n\nargs: {\n  \"base\": \"main\"\n}",
  };
  show(client.createElement(client.ApprovalDetail, { request }));
  assert.equal(one("approval-reason").textContent, "About Review changed files");
  assert.deepEqual(text_of("code-block-language"), ["javascript", "json"]);
  assert.deepEqual(text_of("code-block-pre"), ["export const meta = { name: 'review-changes', description: 'Review changed files' }\nreturn 1", '{\n  "base": "main"\n}']);
  clear();
  show(client.createElement(client.ApprovalDetail, { request: { ...request, text: "return 1\n\nargs: (no args)" } }));
  assert.deepEqual(text_of("code-block-language"), ["javascript"]);
  clear();
});

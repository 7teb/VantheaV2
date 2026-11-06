import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { ReasoningStep, ToolStep } from "../shared/chat.ts";
import { css_block, declarations, read } from "./css-kit.ts";
import { bundle, FakeElement, install_dom, quiet_vx, stub_components } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const stubs: Record<string, string> = {
  ToolRow: 'import { createElement } from "react"; export const ToolRow = (props) => createElement("div", { className: "tool-row", "data-id": props.step.id });',
  ApprovalCard: 'import { createElement } from "react"; export const ApprovalCard = (props) => createElement("div", { className: "approval-stub", "data-call": props.call_id });',
  DotSpinner: 'import { createElement } from "react"; export const DotSpinner = () => createElement("span", { className: "dot-spinner" });',
  Markdown: 'import { createElement } from "react"; export const Markdown = (props) => createElement("div", { className: "markdown-stub" }, props.text);',
};

const render = (steps: (ToolStep | ReasoningStep)[], streaming: boolean, pending = false) =>
  client.flushSync(() => root.render(client.createElement(client.WorkGroup, { chat_id: "c1", steps, streaming, tail: true, pending })));

const clear = () => client.flushSync(() => root.render(null));

const with_class = (name: string, scope: FakeElement = container) => scope.matching((element) => element.className.split(" ").includes(name));

const head = () => with_class("work-group-head")[0] as FakeElement;

const head_label = () => with_class("tool-row-label", head())[0]?.textContent ?? null;

const head_meta = () => with_class("tool-row-duration", head())[0]?.textContent ?? null;

const group = () => with_class("work-group")[0] as FakeElement;

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  const props = (element as unknown as Record<string, { onClick: (event: unknown) => void }>)[props_key];
  client.flushSync(() => props.onClick({ currentTarget: element }));
};

const tool = (id: string, name: string, started: number | null, ended: number | null, args: Record<string, unknown> = {}): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call_${id}`,
  name,
  args,
  status: ended === null ? "running" : "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "ok",
  started_at: started,
  ended_at: ended,
});

const thought = (id: string, started: number, ended: number | null, text: string, status_line?: string): ReasoningStep => ({
  id,
  round: 1,
  kind: "reasoning",
  text,
  started_at: started,
  ended_at: ended,
  ...(status_line ? { status_line } : {}),
});

const now = Date.parse("2026-10-25T12:00:00.000Z");

const finished = (): (ToolStep | ReasoningStep)[] => [
  tool("a1", "read_file", now - 64_000, now - 63_000, { path: "packer.py" }),
  thought("r1", now - 63_000, now - 57_000, "**Checking how start_watcher.py builds the package**\n\nIt calls the packer."),
  tool("a2", "read_file", now - 57_000, now - 56_000, { path: "start_watcher.py" }),
  thought("r2", now - 56_000, now - 54_000, "plain notes without a heading"),
  thought("r3", now - 54_000, now - 53_000, ""),
  tool("g1", "grep_files", now - 53_000, now - 6_000, { query: "trailer" }),
];

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  Object.assign(Reflect.get(globalThis, "window") as object, { setInterval, clearInterval });
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { WorkGroup } from "./src/features/tools/WorkGroup.tsx";',
    ],
    [stub_components("WorkGroup.tsx", stubs), stub_components("ThoughtRow.tsx", stubs)],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("a finished group starts closed with the tool count and the span from the first start to the last end", () => {
  render(finished(), false);
  assert.equal(group().getAttribute("data-open"), "false");
  assert.equal(head().getAttribute("aria-expanded"), "false");
  assert.equal(head_label(), "Read files");
  assert.equal(head_meta(), "58s");
  assert.equal(with_class("dot-spinner").length, 0);
  clear();
});

test("a finished group shows the icon of its first tool call instead of a fixed terminal square", () => {
  const path_d = (d: string) => (element: FakeElement) => element.getAttribute("d") === d;
  const terminal = path_d("M1.5 3L3 1.5H21L22.5 3V21L21 22.5H3L1.5 21V3ZM3 3V21H21V3H3Z");
  const book = path_d("M2.5 2C1.67157 2 1 2.67157 1 3.5V12.5C1 13.3284 1.67157 14 2.5 14H6C6.8178 14 7.54389 13.6073 8 13.0002C8.45612 13.6073 9.1822 14 10 14H13.5C14.3284 14 15 13.3284 15 12.5V3.5C15 2.67157 14.3284 2 13.5 2H10C9.1822 2 8.45612 2.39267 8 2.99976C7.54389 2.39267 6.8178 2 6 2H2.5ZM7.5 4.5V11.5C7.5 12.3284 6.82843 13 6 13H2.5C2.22386 13 2 12.7761 2 12.5V3.5C2 3.22386 2.22386 3 2.5 3H6C6.82843 3 7.5 3.67157 7.5 4.5ZM8.5 11.5V4.5C8.5 3.67157 9.17157 3 10 3H13.5C13.7761 3 14 3.22386 14 3.5V12.5C14 12.7761 13.7761 13 13.5 13H10C9.17157 13 8.5 12.3284 8.5 11.5Z");
  render(finished(), false);
  assert.equal(head().matching(book).length, 1);
  assert.equal(head().matching(terminal).length, 0);
  clear();
  render([tool("c1", "run_command", now - 70_000, now - 69_000, { command: "npm test" }), ...finished()], false);
  assert.equal(head().matching(terminal).length, 1);
  assert.equal(head().matching(book).length, 0);
  clear();
});

test("an open group lists tools and described thoughts in order, blank thoughts stay out", () => {
  render(finished(), false);
  press(head());
  assert.equal(group().getAttribute("data-open"), "true");
  const body = with_class("work-group-body")[0] as FakeElement;
  assert.ok(with_class("work-group-scroll").some((scroll) => scroll.contains(body)));
  assert.deepEqual(
    body.children.map((row) => (row.className === "tool-row" ? `tool:${row.getAttribute("data-id")}` : `thought:${with_class("tool-row-label", row)[0]?.textContent}|${with_class("tool-row-duration", row)[0]?.textContent ?? ""}`)),
    ["tool:a1", "thought:Checking how start_watcher.py builds the package|6s", "tool:a2", "thought:Thought for 2s|", "tool:g1"],
  );
  assert.equal(with_class("thought-mark").length, 2);
  press(head());
  assert.equal(group().getAttribute("data-open"), "false");
  clear();
});

test("a streaming group stays closed, names its streaming thought and shows the elapsed time, approvals stay outside the closed body", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
  Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  try {
    const live = [...finished(), thought("r4", now - 2_000, null, "Planning the fix", "Planning where the length gets written")];
    render(live, true);
    assert.equal(group().getAttribute("data-open"), "false");
    assert.equal(group().getAttribute("data-running"), "true");
    assert.equal(head_label(), "Planning where the length gets written");
    assert.equal(head_meta(), "1m 4s");
    assert.equal(with_class("dot-spinner").length, 1);
    const asking: ToolStep = { ...tool("c1", "run_command", now, null, { command: "npm test" }), status: "awaiting_approval", approval: { kind: "command", command: "npm test" } as ApprovalRequest };
    client.flushSync(() => mock.timers.tick(700));
    render([...finished(), { ...live[6], ended_at: now } as ReasoningStep, asking], true);
    assert.equal(with_class("approval-stub").length, 1);
    assert.equal(with_class("collapsible-body").some((body) => body.contains(with_class("approval-stub")[0] as FakeElement)), false);
    assert.equal(group().getAttribute("data-open"), "false");
  } finally {
    clear();
    mock.timers.reset();
    Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  }
});

test("a running group shows the dots in its head also while a command waits for the review, the rows keep their own icons", () => {
  const reviewing: ToolStep = { ...tool("c2", "run_command", now - 4_000, null, { command: "npm test" }), progress: { label: "", lines: null, output_tail: null, phase: "review" } };
  render([...finished(), reviewing], true);
  assert.equal(group().getAttribute("data-review"), "true");
  assert.equal(with_class("dot-spinner").length, 1);
  assert.equal(with_class("dot-spinner", head()).length, 1);
  press(head());
  assert.equal(with_class("dot-spinner", with_class("work-group-body")[0] as FakeElement).length, 0);
  clear();
});

test("a group that waits for the next round keeps the dots and says Thinking instead of showing its summary", () => {
  render(finished(), true, true);
  assert.equal(group().getAttribute("data-running"), "true");
  assert.equal(with_class("dot-spinner", head()).length, 1);
  assert.equal(head_label(), "Thinking");
  clear();
});

test("every head label stays at least 650 ms before the next one replaces it", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
  Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  try {
    const base = finished();
    render([...base, thought("r4", now, null, "")], true);
    assert.equal(head_label(), "Thinking");
    render([...base, thought("r4", now, now + 100, "x"), tool("a3", "read_file", now + 100, null, { path: "build.py" })], true);
    assert.equal(head_label(), "Thinking");
    client.flushSync(() => mock.timers.tick(400));
    assert.equal(head_label(), "Thinking");
    client.flushSync(() => mock.timers.tick(250));
    assert.equal(head_label(), "Reading build.py");
    client.flushSync(() => mock.timers.tick(1_000));
    render([...base, thought("r4", now, now + 100, "x"), tool("a3", "read_file", now + 100, now + 1_700, { path: "build.py" })], true);
    assert.equal(head_label(), "Read files");
    assert.equal(with_class("dot-spinner").filter((spinner) => !spinner.leaving).length, 0);
  } finally {
    clear();
    mock.timers.reset();
    Object.assign(Reflect.get(globalThis, "window") as object, { setTimeout, clearTimeout, setInterval, clearInterval });
  }
});

const scroll_probe = () => {
  const resizes: (() => void)[] = [];
  const listeners = new Map<string, () => void>();
  const observer = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const listen = Reflect.get(FakeElement.prototype, "addEventListener");
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  });
  Reflect.set(FakeElement.prototype, "addEventListener", function (this: FakeElement, name: string, listener: () => void) {
    listeners.set(`${name}:${this.className}`, listener);
  });
  return {
    grow: (node: FakeElement, height: number) => {
      Object.assign(node, { scrollHeight: height });
      resizes.at(-1)?.();
    },
    scroll_to: (node: FakeElement, top: number) => {
      Object.assign(node, { scrollTop: top });
      listeners.get(`scroll:${node.className}`)?.();
    },
    click_body: () => listeners.get("click:work-group-body")?.(),
    restore: () => {
      Reflect.set(FakeElement.prototype, "addEventListener", listen);
      if (observer) {
        Object.defineProperty(globalThis, "ResizeObserver", observer);
      }
    },
  };
};

test("the group body stays at its bottom while rows grow, unless the user scrolled up", () => {
  const { grow, scroll_to, restore: unprobe } = scroll_probe();
  try {
    render([...finished(), thought("r4", now, null, "")], true);
    const live = with_class("work-group-scroll")[0] as FakeElement;
    Object.assign(live, { scrollTop: 0, clientHeight: 288 });
    grow(live, 600);
    assert.equal(Reflect.get(live, "scrollTop"), 600);
    scroll_to(live, 100);
    grow(live, 700);
    assert.equal(Reflect.get(live, "scrollTop"), 100);
    scroll_to(live, 412);
    grow(live, 800);
    assert.equal(Reflect.get(live, "scrollTop"), 800);
    clear();
    render(finished(), false);
    const loaded = with_class("work-group-scroll")[0] as FakeElement;
    Object.assign(loaded, { scrollTop: 0, clientHeight: 288 });
    grow(loaded, 600);
    assert.equal(Reflect.get(loaded, "scrollTop"), 0);
  } finally {
    clear();
    unprobe();
  }
});

test("a row the user opens never moves the group body, and the body stops following once the turn ends", () => {
  const { grow, scroll_to, click_body, restore: unprobe } = scroll_probe();
  try {
    render([...finished(), thought("r4", now, null, "")], true);
    const body = with_class("work-group-scroll")[0] as FakeElement;
    Object.assign(body, { scrollTop: 0, clientHeight: 288 });
    grow(body, 600);
    assert.equal(Reflect.get(body, "scrollTop"), 600);
    click_body();
    grow(body, 1_000);
    assert.equal(Reflect.get(body, "scrollTop"), 600);
    scroll_to(body, 712);
    grow(body, 1_100);
    assert.equal(Reflect.get(body, "scrollTop"), 1_100);
    clear();
    render([...finished(), thought("r4", now, null, "")], true);
    const short = with_class("work-group-scroll")[0] as FakeElement;
    Object.assign(short, { scrollTop: 0, clientHeight: 200, scrollHeight: 200 });
    render(finished(), false);
    press(head());
    grow(short, 900);
    assert.equal(Reflect.get(short, "scrollTop"), 0);
  } finally {
    clear();
    unprobe();
  }
});

test("the group body is capped, keeps the app scrollbar and fades its edges only while it scrolls", () => {
  const scroll = declarations(css_block(read("features/tools/WorkGroup.css"), ".work-group-scroll {"));
  assert.equal(scroll["max-height"], "min(18rem, 50vh)");
  assert.equal(scroll["overflow-y"], "auto");
  assert.equal(scroll["scrollbar-width"], undefined);
  assert.equal(scroll["animation-timeline"], "scroll(self y)");
  assert.match(scroll["mask-image"], /var\(--mask\) var\(--group-fade-top\)/);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { ToolStep } from "../shared/chat.ts";
import type { ComputerSession } from "../shared/ipc/computer.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { bundle, install_dom, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};
const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
const sends: unknown[][] = [];
let state_answer: ComputerSession = { chat_id: "chat-1", shortcut: true };

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const render = (element: unknown) => client.flushSync(() => root.render(element));

const by_class = (name: string) => container.matching((element) => element.className.split(" ").includes(name));

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const step = (name: string, view: ToolView, extra: Partial<ToolStep> = {}): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: 2500,
  ...extra,
});

before(async () => {
  const dom = install_dom({
    invoke: async (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      return name === "computer:state" ? state_answer : undefined;
    },
    on: (name, listener) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
    send: (...args: unknown[]) => {
      sends.push(args);
    },
  });
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { ComputerApproval } from "./src/features/tools/ComputerApproval.tsx";',
      'export { ComputerBody } from "./src/features/tools/bodies-computer.tsx";',
      'export { ComputerLiveNote } from "./src/features/chat/ComputerLiveNote.tsx";',
      'export { ComputerIndicator } from "./src/features/computer/ComputerIndicator.tsx";',
      'export { computer_store, init_computer } from "./src/state/computer.ts";',
      'export { chat_view_store } from "./src/state/chat-view.ts";',
    ],
    [stub_components("none", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("the approval card names the display and says that screenshots go to the model provider", () => {
  const request: ApprovalRequest = { kind: "computer_use", display: "1", real_width: 2560, real_height: 1440 };
  render(client.createElement(client.ComputerApproval, { request }));
  assert.equal(by_class("computer-approval-head")[0]?.textContent, "Display 1 · 2560 × 1440");
  assert.deepEqual(
    by_class("computer-approval-line").map((line) => line.textContent),
    ["While I work, screenshots of your screen are sent to the model provider.", "I will ask you before anything that sends, buys, deletes or publishes."],
  );
});

test("the live note shows only in the chat that controls the computer and its Stop ends that turn", async () => {
  const stop_init = client.init_computer();
  await settled();
  render(client.createElement(client.ComputerLiveNote, { chat_id: "chat-2" }));
  assert.equal(by_class("computer-live").length, 0);
  render(client.createElement(client.ComputerLiveNote, { chat_id: "chat-1" }));
  assert.equal(by_class("computer-live").length, 1);
  assert.equal(by_class("computer-live-text")[0]?.textContent, "Controlling your computer");
  const stop = by_class("button")[0] as FakeElement;
  assert.equal(stop.textContent, "Stop");
  press(stop);
  await settled();
  assert.deepEqual(calls.filter((call) => call.name === "turn:stop").map((call) => call.args), [["chat-1"]]);
  client.flushSync(() => listeners.get("computer:changed")?.({ chat_id: null, shortcut: false }));
  assert.equal(by_class("computer-live").length, 0);
  stop_init();
});

test("the overlay names VantheaX, shows the stop keys only while the shortcut is registered, and its Stop asks main to stop", () => {
  client.computer_store.set({ chat_id: "chat-1", shortcut: false });
  render(client.createElement(client.ComputerIndicator, {}));
  assert.equal(by_class("computer-indicator-text")[0]?.textContent, "VantheaX is controlling your computer");
  assert.equal(by_class("computer-indicator-keys").length, 0);
  client.flushSync(() => client.computer_store.set({ chat_id: "chat-1", shortcut: true }));
  assert.equal(by_class("computer-indicator-keys")[0]?.textContent, "Ctrl+Alt+Esc");
  sends.length = 0;
  press(by_class("button")[0] as FakeElement);
  assert.deepEqual(sends, [["computer:stop"]]);
  render(null);
});

test("a session event that arrives before the first state read is not overwritten by it", async () => {
  state_answer = { chat_id: "chat-old", shortcut: false };
  const stop_init = client.init_computer();
  listeners.get("computer:changed")?.({ chat_id: "chat-new", shortcut: true });
  await settled();
  assert.deepEqual(client.computer_store.get(), { chat_id: "chat-new", shortcut: true });
  stop_init();
});

test("a click row shows the screenshot it acted on with the click point marked", () => {
  const shot = step("computer_screenshot", { kind: "computer", action: "screenshot", image_w: 1280, image_h: 720 }, { id: "tool:shot", images: [{ id: "img_shot.png", label: "screenshot" }] });
  const click_view: ToolView = {
    kind: "computer",
    action: "click",
    x: 960,
    y: 180,
    button: "left",
    count: 1,
    modifiers: [],
    shot: { message_id: "a1", call_id: "call-computer_screenshot" },
  };
  const click = step("computer_click", click_view, { id: "tool:click" });
  const chat = { id: "chat-1", messages: [{ id: "a1", role: "assistant", status: "done", steps: [shot, click] }] };
  client.chat_view_store.set({ entries: { "chat-1": { status: "ready", chat, held: [], waiting: {}, stale: false, context: null } }, recent: ["chat-1"] });
  render(client.createElement(client.ComputerBody, { view: click_view, step: click, chat_id: "chat-1" }));
  const image = container.matching((element) => element.tagName === "IMG")[0];
  assert.equal(image?.getAttribute("src"), "vx-media://attachment/img_shot.png");
  const marks = by_class("computer-shot-mark");
  assert.equal(marks.length, 1);
  assert.equal(marks[0].style.left, "75%");
  assert.equal(marks[0].style.top, "25%");
  assert.equal(by_class("computer-shot-path").length, 0);
});

test("a drag row marks both ends and joins them with a path", () => {
  const shot = step("computer_screenshot", { kind: "computer", action: "screenshot", image_w: 1000, image_h: 500 }, { id: "tool:shot", images: [{ id: "img_drag.png", label: "screenshot" }] });
  const drag_view: ToolView = {
    kind: "computer",
    action: "drag",
    x: 100,
    y: 50,
    to_x: 900,
    to_y: 450,
    button: "left",
    shot: { message_id: "a1", call_id: "call-computer_screenshot" },
  };
  const drag = step("computer_drag", drag_view, { id: "tool:drag" });
  const chat = { id: "chat-1", messages: [{ id: "a1", role: "assistant", status: "done", steps: [shot, drag] }] };
  client.chat_view_store.set({ entries: { "chat-1": { status: "ready", chat, held: [], waiting: {}, stale: false, context: null } }, recent: ["chat-1"] });
  render(client.createElement(client.ComputerBody, { view: drag_view, step: drag, chat_id: "chat-1" }));
  assert.deepEqual(
    by_class("computer-shot-mark").map((mark) => [mark.style.left, mark.style.top]),
    [
      ["10%", "10%"],
      ["90%", "90%"],
    ],
  );
  assert.equal(by_class("computer-shot-path").length, 1);
});

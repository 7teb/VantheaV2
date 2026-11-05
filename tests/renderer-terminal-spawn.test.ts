import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";

const invoked: string[] = [];
const vx: Vx = {
  invoke: async (name) => {
    invoked.push(name);
    return undefined;
  },
  on: () => () => {},
  send: () => {},
};

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const view_stub = 'import { createElement } from "react"; export const TerminalView = (props) => createElement("div", { "data-stub": "TerminalView", "data-tab": props.tab_id });';

const tabs = (key: string) => client.terminal_group(client.terminal_store.get(), key).tabs;

const panel_open = () => client.ui_store.get().dock.kind === "terminal";

const open_panel = () => {
  if (!panel_open()) {
    client.toggle_dock("terminal");
  }
};

const show = (chat_id: string) =>
  client.flushSync(() => root.render(client.createElement(client.TerminalDock, { visible: true, chat_id, project_path: "D:/project" })));

const new_terminal_button = () => container.matching((element) => element.nodeName === "BUTTON" && element.textContent === "New terminal")[0];

const views = () => container.matching((element) => element.getAttribute("data-stub") === "TerminalView");

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { init_terminal, terminal_store } from "./src/state/terminal.ts";',
      'export { terminal_group } from "./src/state/terminal-groups.ts";',
      'export { open_chat, start_new_chat, toggle_dock, ui_store } from "./src/state/ui.ts";',
      'export { TerminalDock } from "./src/features/docks/terminal/TerminalDock.tsx";',
    ],
    [stub_components("TerminalDock.tsx", { TerminalView: view_stub })],
  );
  client.init_terminal();
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("opening the panel starts a terminal for the current chat, switching chats while it is open starts none", () => {
  client.open_chat("t1", "D:/project");
  assert.equal(tabs("t1").length, 0);
  client.toggle_dock("terminal");
  assert.equal(tabs("t1").length, 1);
  client.open_chat("t2", "D:/project");
  client.open_chat("t3", "D:/other");
  client.start_new_chat("D:/project");
  assert.deepEqual([tabs("t2").length, tabs("t3").length, tabs("new:D:/project").length], [0, 0, 0]);
  client.open_chat("t1", "D:/project");
  assert.equal(tabs("t1").length, 1);
});

test("opening the panel again starts a terminal only for a chat that has none", () => {
  client.toggle_dock("browser");
  client.open_chat("t2", "D:/project");
  assert.equal(tabs("t2").length, 0);
  client.toggle_dock("terminal");
  assert.equal(tabs("t2").length, 1);
  client.toggle_dock("terminal");
  client.toggle_dock("terminal");
  assert.equal(tabs("t2").length, 1);
  assert.equal(tabs("t3").length, 0);
});

test("a chat without a terminal shows a New terminal button in the open panel and only its click starts one", () => {
  open_panel();
  client.open_chat("t5", "D:/project");
  invoked.length = 0;
  show("t5");
  assert.equal(tabs("t5").length, 0);
  assert.equal(views().length, 0);
  const button = new_terminal_button();
  assert.ok(button);
  assert.deepEqual(invoked, []);

  press(button);
  assert.equal(tabs("t5").length, 1);
  assert.deepEqual(views().map((view) => view.getAttribute("data-tab")), [tabs("t5")[0].id]);
  assert.equal(new_terminal_button(), undefined);

  show("t1");
  assert.equal(views().length, 1);
  assert.equal(tabs("t1").length, 1);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { drop_tab, move_group, put_tab, terminal_group, type TerminalState, type TerminalTab } from "../src/state/terminal-groups.ts";

const globals = ["window", "localStorage"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const invoked: { name: string; args: unknown[] }[] = [];
const sent: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
const pending: { request: unknown; resolve: (pty_id: string) => void }[] = [];
let client: any;

type Captured = { data: string[]; exits: number[]; released: number; output: { data: (text: string) => void; exit: (code: number) => void; release: () => void } };

const capture = (): Captured => {
  const captured: Captured = {
    data: [],
    exits: [],
    released: 0,
    output: {
      data: (text) => captured.data.push(text),
      exit: (code) => captured.exits.push(code),
      release: () => {
        captured.released += 1;
      },
    },
  };
  return captured;
};

const first = capture();
const second = capture();

const group = (key: string) => terminal_group(client.terminal_store.get(), key);

const emit = (name: string, payload: unknown) => listeners.get(name)?.(payload);

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const start = (tab_id: string, captured: Captured) => client.start_terminal(tab_id, 80, 24, captured.output);

const answer_create = (pty_id: string) => pending.shift()?.resolve(pty_id);

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    vx: {
      invoke: (name: string, ...args: unknown[]) => {
        invoked.push({ name, args });
        if (name === "terminal:create") {
          return new Promise<string>((resolve) => pending.push({ request: args[0], resolve }));
        }
        return Promise.resolve(undefined);
      },
      send: (name: string, ...args: unknown[]) => sent.push({ name, args }),
      on: (name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    },
  } });
  const entry = 'export * from "./src/state/terminal.ts";';
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", write: false, legalComments: "none", logLevel: "silent" });
  client = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  client.init_terminal();
});

beforeEach(() => {
  invoked.length = 0;
  sent.length = 0;
});

after(() => {
  for (const name of globals) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("every chat gets its own terminal group and its pty is created in that chat's scope", async () => {
  client.ensure_terminal_tab("c1", "D:/project");
  client.ensure_terminal_tab("c1", "D:/project");
  client.ensure_terminal_tab("c2", "D:/project");
  assert.equal(group("c1").tabs.length, 1);
  assert.equal(group("c2").tabs.length, 1);
  assert.equal(group("new:D:/project").tabs.length, 0);

  const starting = [start(group("c1").tabs[0].id, first), start(group("c2").tabs[0].id, second)];
  assert.deepEqual(pending.map((entry) => entry.request), [
    { chat_id: "c1", project_path: "D:/project", cols: 80, rows: 24 },
    { chat_id: "c2", project_path: "D:/project", cols: 80, rows: 24 },
  ]);
  answer_create("p1");
  answer_create("p2");
  assert.deepEqual(await Promise.all(starting), [true, true]);

  emit("terminal:data", { terminal_id: "p2", data: "PS c2> " });
  emit("terminal:data", { terminal_id: "p1", data: "PS c1> " });
  assert.deepEqual(first.data, ["PS c1> "]);
  assert.deepEqual(second.data, ["PS c2> "]);
  client.write_terminal(group("c2").tabs[0].id, "dir\r");
  assert.deepEqual(sent, [{ name: "terminal:input", args: ["p2", "dir\r"] }]);
});

test("deleting a chat closes and releases only that chat's terminals", () => {
  emit("chats:removed", { chat_id: "c1" });
  assert.equal(group("c1").tabs.length, 0);
  assert.equal(group("c2").tabs.length, 1);
  assert.equal(first.released, 1);
  assert.equal(second.released, 0);
  assert.deepEqual(sent, [{ name: "terminal:close", args: ["p1"] }]);
  emit("terminal:data", { terminal_id: "p1", data: "late" });
  emit("terminal:exit", { terminal_id: "p1", exit_code: 0 });
  assert.deepEqual(first.data, ["PS c1> "]);
  assert.deepEqual(first.exits, []);
  assert.equal(group("c2").tabs[0].status, "running");
});

test("a chat created from the new-chat screen takes over the draft terminals, including one still starting", async () => {
  const running_tab = client.add_terminal_tab(null, "D:/new");
  const running = capture();
  const running_start = start(running_tab, running);
  answer_create("p3");
  await running_start;
  const starting_tab = client.add_terminal_tab(null, "D:/new");
  const starting = capture();
  const starting_start = start(starting_tab, starting);
  invoked.length = 0;

  client.adopt_terminals("new:D:/new", "c9");
  assert.equal(group("new:D:/new").tabs.length, 0);
  assert.deepEqual(group("c9").tabs.map((tab: TerminalTab) => [tab.id, tab.chat_id]), [
    [running_tab, "c9"],
    [starting_tab, "c9"],
  ]);
  assert.equal(group("c9").active_id, starting_tab);
  assert.deepEqual(invoked, [{ name: "terminal:adopt", args: ["p3", "c9"] }]);

  answer_create("p4");
  assert.equal(await starting_start, true);
  await settled();
  assert.deepEqual(invoked.at(-1), { name: "terminal:adopt", args: ["p4", "c9"] });
});

test("a tab dropped while its pty was starting closes the pty once it arrives", async () => {
  const tab_id = client.add_terminal_tab("c5", "");
  const output = capture();
  const starting = start(tab_id, output);
  client.close_terminal_tab(tab_id);
  assert.equal(output.released, 1);
  answer_create("p5");
  assert.equal(await starting, false);
  assert.deepEqual(sent, [{ name: "terminal:close", args: ["p5"] }]);
  emit("terminal:data", { terminal_id: "p5", data: "ignored" });
  assert.deepEqual(output.data, []);
});

test("closing a tab picks its neighbour and an emptied group disappears", () => {
  const tab = (id: string, chat_id: string | null = "c1"): TerminalTab => ({ id, chat_id, project_path: "", status: "running", exit_code: null, error: "" });
  let state: TerminalState = { groups: {} };
  state = put_tab(state, "c1", tab("a"));
  state = put_tab(state, "c1", tab("b"));
  state = put_tab(state, "c1", tab("c"));
  state = drop_tab(state, "c");
  assert.equal(terminal_group(state, "c1").active_id, "b");
  state = drop_tab(drop_tab(state, "a"), "b");
  assert.deepEqual(state.groups, {});
  const merged = move_group(put_tab(put_tab({ groups: {} }, "c2", tab("x", "c2")), "new:P", tab("y", null)), "new:P", "c2");
  assert.deepEqual(Object.keys(merged.groups), ["c2"]);
  assert.deepEqual(terminal_group(merged, "c2").tabs.map((entry) => [entry.id, entry.chat_id]), [
    ["x", "c2"],
    ["y", "c2"],
  ]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { create_terminal_registry, terminal_limits, type PtyOptions, type PtyProcess } from "../electron/terminal/sessions.ts";

type FakePty = PtyProcess & {
  options: PtyOptions;
  written: string[];
  sizes: [number, number][];
  killed: number;
  emit_data: (data: string) => void;
  emit_exit: (code: number) => void;
};

const harness = (kill_throws = false) => {
  const spawned: FakePty[] = [];
  const data: [string, string][] = [];
  const exits: [string, number][] = [];
  let counter = 0;
  const registry = create_terminal_registry(
    (options) => {
      let on_data: (data: string) => void = () => undefined;
      let on_exit: (code: number) => void = () => undefined;
      const pty: FakePty = {
        options,
        written: [],
        sizes: [],
        killed: 0,
        write: (chunk) => pty.written.push(chunk),
        resize: (cols, rows) => pty.sizes.push([cols, rows]),
        kill: () => {
          pty.killed += 1;
          if (kill_throws) {
            throw new Error("already exited");
          }
        },
        on_data: (listener) => {
          on_data = listener;
        },
        on_exit: (listener) => {
          on_exit = listener;
        },
        emit_data: (chunk) => on_data(chunk),
        emit_exit: (code) => on_exit(code),
      };
      spawned.push(pty);
      return pty;
    },
    { data: (id, chunk) => data.push([id, chunk]), exit: (id, code) => exits.push([id, code]) },
    () => `t${++counter}`,
  );
  return { registry, spawned, data, exits };
};

test("create spawns a pty with clamped size and forwards its output under the terminal id", () => {
  const { registry, spawned, data } = harness();
  const id = registry.create("c1", { cwd: "D:\\work", cols: 0.4, rows: 99999 });
  assert.equal(id, "t1");
  assert.deepEqual(spawned[0].options, { cwd: "D:\\work", cols: terminal_limits.min_cols, rows: terminal_limits.max_rows });
  spawned[0].emit_data("PS D:\\work> ");
  assert.deepEqual(data, [["t1", "PS D:\\work> "]]);
  assert.deepEqual(registry.ids(), ["t1"]);
});

test("input and resize reach only the addressed pty, unknown ids are ignored", () => {
  const { registry, spawned } = harness();
  const first = registry.create(null, { cwd: "a", cols: 80, rows: 24 });
  registry.create(null, { cwd: "b", cols: 80, rows: 24 });
  registry.input(first, "dir\r");
  registry.resize(first, 120.6, 40);
  registry.input("missing", "x");
  registry.resize("missing", 10, 10);
  assert.deepEqual(spawned[0].written, ["dir\r"]);
  assert.deepEqual(spawned[0].sizes, [[121, 40]]);
  assert.deepEqual(spawned[1].written, []);
  assert.deepEqual(spawned[1].sizes, []);
});

test("a process exit removes the session and reports the exit code once", () => {
  const { registry, spawned, exits, data } = harness();
  const id = registry.create(null, { cwd: "a", cols: 80, rows: 24 });
  spawned[0].emit_exit(3);
  spawned[0].emit_exit(3);
  spawned[0].emit_data("late");
  assert.deepEqual(exits, [[id, 3]]);
  assert.deepEqual(data, []);
  assert.deepEqual(registry.ids(), []);
  registry.input(id, "ignored");
  assert.deepEqual(spawned[0].written, []);
});

test("close kills the pty and suppresses its later output and exit", () => {
  const { registry, spawned, exits, data } = harness();
  const id = registry.create(null, { cwd: "a", cols: 80, rows: 24 });
  registry.close(id);
  registry.close(id);
  spawned[0].emit_data("after close");
  spawned[0].emit_exit(1);
  assert.equal(spawned[0].killed, 1);
  assert.deepEqual(data, []);
  assert.deepEqual(exits, []);
  assert.deepEqual(registry.ids(), []);
});

test("close_all kills every live session even when a kill throws", () => {
  const { registry, spawned } = harness(true);
  registry.create(null, { cwd: "a", cols: 80, rows: 24 });
  registry.create(null, { cwd: "b", cols: 80, rows: 24 });
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    registry.close_all();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(
    spawned.map((pty) => pty.killed),
    [1, 1],
  );
  assert.equal(warnings.length, 2);
  assert.deepEqual(registry.ids(), []);
});

test("close_owner kills only the terminals of that chat and leaves drafts and other chats running", () => {
  const { registry, spawned, exits } = harness();
  const first = registry.create("chat-a", { cwd: "a", cols: 80, rows: 24 });
  const other = registry.create("chat-b", { cwd: "b", cols: 80, rows: 24 });
  const draft = registry.create(null, { cwd: "c", cols: 80, rows: 24 });
  const second = registry.create("chat-a", { cwd: "d", cols: 80, rows: 24 });
  registry.close_owner("chat-a");
  assert.deepEqual(
    spawned.map((pty) => pty.killed),
    [1, 0, 0, 1],
  );
  assert.deepEqual(registry.ids(), [other, draft]);
  spawned[0].emit_exit(0);
  spawned[3].emit_data("late");
  assert.deepEqual(exits, []);
  registry.input(first, "x");
  registry.input(second, "x");
  assert.deepEqual(spawned[0].written, []);
  assert.deepEqual(spawned[3].written, []);
});

test("adopt hands a draft terminal to a chat so deleting that chat closes it", () => {
  const { registry, spawned } = harness();
  const draft = registry.create(null, { cwd: "a", cols: 80, rows: 24 });
  const kept = registry.create(null, { cwd: "b", cols: 80, rows: 24 });
  registry.adopt(draft, "chat-a");
  registry.adopt(draft, "chat-a");
  registry.adopt("missing", "chat-a");
  registry.close_owner("chat-a");
  assert.deepEqual(
    spawned.map((pty) => pty.killed),
    [1, 0],
  );
  assert.deepEqual(registry.ids(), [kept]);
});

test("adopt refuses to move a terminal that already belongs to another chat", () => {
  const { registry, spawned } = harness();
  const owned = registry.create("chat-a", { cwd: "a", cols: 80, rows: 24 });
  assert.throws(() => registry.adopt(owned, "chat-b"), /belongs to chat chat-a/);
  registry.close_owner("chat-b");
  assert.equal(spawned[0].killed, 0);
  registry.close_owner("chat-a");
  assert.equal(spawned[0].killed, 1);
});

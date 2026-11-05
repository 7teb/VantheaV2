import assert from "node:assert/strict";
import { test } from "node:test";
import { ComputerControl, type ComputerBackend } from "../electron/computer/control.ts";
import { map_point, parse_keys, read_modifiers, select_display, type Display, type InputAction } from "../electron/computer/coords.ts";
import { install_computer } from "../electron/computer/service.ts";
import { computer_tools } from "../electron/tools/computer/index.ts";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { tool_context } from "./peer-flow-kit.ts";

const display: Display = { id: "1", x: -2560, y: 120, width: 2560, height: 1440, primary: true };
const fixture = () => {
  const calls: InputAction[] = [];
  const approvals: ApprovalRequest[] = [];
  let captures = 0;
  let hidden = 0;
  const backend: ComputerBackend = {
    displays: async () => [display],
    capture: async () => { captures++; return { width: 1280, height: 720, image: { bytes: Buffer.from("image"), mime: "image/png", label: "test" } }; },
    perform: async (action) => { calls.push(action); },
    show: async () => true,
    hide: () => { hidden++; },
    publish: () => {},
    close: () => {},
  };
  const control = new ComputerControl(backend);
  const context = (over: Partial<ToolContext> = {}) => {
    const ctx = tool_context("chat-1", "main", over);
    return { ...ctx, model: { ...ctx.model, vision: true }, approve: async (request: ApprovalRequest) => { approvals.push(request); return { approved: true, grant: "chat" as const, feedback: "" }; }, ...over };
  };
  return { control, backend, context, calls, approvals, captures: () => captures, hidden: () => hidden };
};

for (const mode of ["ask", "auto"] as const) test(`${mode} asks once before capture, then remembers only that chat until restart`, async () => {
  const f = fixture();
  const ctx = f.context({ mode });
  const first = await f.control.run(ctx, { op: "screenshot", display: null });
  assert.equal(first.status, "done");
  assert.deepEqual(f.approvals, [{ kind: "computer_use", display: "1", real_width: 2560, real_height: 1440 }]);
  assert.equal(f.captures(), 1);
  f.control.release(ctx.chat_id, ctx.turn_id);
  await f.control.run(f.context({ turn_id: "next" }), { op: "screenshot", display: null });
  assert.equal(f.approvals.length, 1);
  f.control.release(ctx.chat_id, "next");
  await f.control.run(f.context({ chat_id: "chat-2", turn_id: "other" }), { op: "screenshot", display: null });
  assert.equal(f.approvals.length, 2);
  f.control.close();
  await f.control.run(ctx, { op: "screenshot", display: null });
  assert.equal(f.approvals.length, 3);
  f.control.close();
});

test("full mode does not ask; declining in auto captures nothing and blocks retries in the same turn", async () => {
  const f = fixture();
  const ctx = f.context({ mode: "full" });
  assert.equal((await f.control.run(ctx, { op: "screenshot", display: null })).status, "done");
  assert.equal(f.approvals.length, 0);
  f.control.release(ctx.chat_id, ctx.turn_id);
  const denied = f.context({ approve: async () => ({ approved: false, grant: "once", feedback: "No" }) });
  assert.equal((await f.control.run(denied, { op: "screenshot", display: null })).status, "denied");
  assert.equal((await f.control.run(f.context(), { op: "screenshot", display: null })).status, "denied");
  assert.equal(f.captures(), 1);
  assert.equal(f.control.state().chat_id, null);
});

test("a pending approval holds the lock and cannot publish capture or input", async () => {
  const f = fixture();
  let answer: (() => void) | undefined;
  const ctx = f.context({ approve: () => new Promise((resolve) => { answer = () => resolve({ approved: true, grant: "chat", feedback: "" }); }) });
  const first = f.control.run(ctx, { op: "screenshot", display: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.captures(), 0);
  assert.equal((await f.control.run(f.context({ chat_id: "chat-2" }), { op: "screenshot", display: null })).status, "denied");
  answer?.();
  await first;
  f.control.release(ctx.chat_id, "wrong-turn");
  assert.equal(f.control.state().chat_id, ctx.chat_id);
  f.control.close();
});

test("coordinates use the fitted screenshot and its exact reference, including clamped endpoints", async () => {
  const f = fixture();
  const ctx = f.context();
  await f.control.run(ctx, { op: "screenshot", display: null });
  const click = await f.control.run({ ...ctx, call_id: "click" }, { op: "click", x: 9999, y: -1, button: "right", count: 2, modifiers: [16], modifier_names: ["Shift"] });
  assert.deepEqual(f.calls[0], { op: "click", x: -1, y: 120, button: "right", count: 2, modifiers: [16], modifier_names: ["Shift"] });
  assert.deepEqual(click.view, { kind: "computer", action: "click", x: 1279, y: 0, button: "right", count: 2, modifiers: ["Shift"], shot: { message_id: ctx.turn_id, call_id: ctx.call_id } });
  assert.match(click.text, /clamped/);
  f.control.close();
});

test("Stop cancels waits and input before allowing another chat; delete also forgets the grant", async () => {
  const f = fixture();
  const abort = new AbortController();
  const ctx = f.context({ signal: abort.signal });
  await f.control.run(ctx, { op: "screenshot", display: null });
  const wait = f.control.run(ctx, { op: "wait", seconds: 10 });
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort(new Error("stopped"));
  await assert.rejects(wait);
  assert.equal(f.control.state().chat_id, null);
  assert.ok(f.hidden() > 0);
  f.control.forget(ctx.chat_id);
  await f.control.run(f.context({ turn_id: "after-delete" }), { op: "screenshot", display: null });
  assert.equal(f.approvals.length, 2);
  f.control.close();
});

test("failed input stops later actions without replay and retains no live session", async () => {
  const f = fixture();
  const ctx = f.context();
  await f.control.run(ctx, { op: "screenshot", display: null });
  f.backend.perform = async () => { throw new Error("protected window"); };
  assert.equal((await f.control.run(ctx, { op: "key", keys: [13] })).status, "failed");
  assert.equal((await f.control.run(ctx, { op: "key", keys: [13] })).status, "denied");
  assert.equal(f.control.state().chat_id, null);
});

test("all eight tools are Windows vision-only, main-only, sequential, and enforce profile at execution", async () => {
  const f = fixture();
  install_computer(f.control);
  try {
    assert.equal(computer_tools.length, 8);
    for (const tool of computer_tools) {
      assert.deepEqual(tool.profiles, ["main"]);
      assert.equal(tool.concurrent, false);
      const ctx = f.context();
      assert.equal(tool.available(ctx.settings, { ...ctx.model, vision: false }), false);
      assert.equal(tool.available(ctx.settings, ctx.model), process.platform === "win32");
    }
    const screenshot = computer_tools[0];
    assert.equal((await screenshot.execute(f.context({ profile: "worker" }), {})).status, "denied");
    assert.equal(f.captures(), 0);
    for (const [name, args] of [["computer_click", { x: NaN, y: 1 }], ["computer_click", { x: 1, y: 2, count: 4 }], ["computer_key", { keys: "Ctrl+unsupported" }], ["computer_wait", { seconds: 11 }]] as const) {
      assert.throws(() => computer_tools.find((tool) => tool.spec.name === name)!.execute(f.context(), args));
    }
  } finally { f.control.close(); install_computer(null); }
});

test("display and keyboard parsing preserve real pixel origins and reject unknown modifiers", () => {
  const frame = { display, width: 1280, height: 720, ref: { message_id: "m", call_id: "c" } };
  assert.deepEqual(map_point(frame, { x: 0, y: 0 }).real, { x: -2560, y: 120 });
  assert.deepEqual(parse_keys("ctrl+shift+s"), [17, 16, 83]);
  assert.deepEqual(parse_keys("Return"), [13]);
  assert.throws(() => read_modifiers(["garbage"]));
  assert.equal(select_display([display], null), display);
  assert.throws(() => select_display([display], "missing"));
});

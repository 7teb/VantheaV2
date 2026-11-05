import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { TurnHooks } from "../electron/hooks/turn-hooks.ts";
import { turn_hooks } from "../electron/hooks/turn-hooks.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { hook, ps_path, set_hooks, start_settings, temp_root } from "./hooks-kit.ts";
import { completed, ends, harness, make_tool, model, tool_call, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();
let root = "";
before(async () => { root = await temp_root("post-stop"); await start_settings(root); });
after(async () => { if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const gates = (post_tool: TurnHooks["post_tool"]): TurnHooks => ({
  pre_tool: async () => ({ kind: "run", runs: [] }), post_tool,
  stop: async () => ({ kind: "end" }), stop_failure: async () => {},
});

for (const status of ["done", "failed"] as const) {
  test(`Stop inside the post hook preserves the executed ${status} result and replay`, async () => {
    let executed = 0;
    let streamed = 0;
    const tool = make_tool("probe", async () => { executed += 1; return { status, text: "already executed", view: { kind: "text", text: "visible result" } }; });
    const h = harness(async () => { streamed += 1; return completed({ tool_calls: [tool_call("probe")] }); }, [tool]);
    h.session.hooks = gates(async () => { h.controller.abort(new Error("stopped in post hook")); return { kind: "aborted" }; });
    await run_turn_loop(h.session, h.messages);
    assert.equal(executed, 1);
    assert.equal(streamed, 1);
    const ended = h.events.filter((event) => event.type === "tool_end");
    assert.equal(ended.length, 1);
    assert.equal(ended[0]?.status, status);
    assert.equal(ended[0]?.result_text, "already executed");
    assert.deepEqual(ended[0]?.view, { kind: "text", text: "visible result" });
    const message = transcript(h.events);
    const step = message.steps.find((entry) => entry.kind === "tool");
    assert.equal(step?.kind === "tool" && step.status, status);
    assert.equal(step?.kind === "tool" && step.result_text, "already executed");
    const replay = await build_api_messages({ system: "s", summary: null, messages: [message], model, agent_tools: false });
    assert.ok(replay.some((entry) => entry.role === "tool" && entry.content === "already executed"));
    assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
    assert.equal(h.events.at(-1)?.type, "end");
  });
}

test("Stop in a post hook keeps stored tool images and prevents the next sequential tool", async () => {
  let later = 0;
  const probe = make_tool("probe", async () => ({ status: "done", text: "shot result", view: null, images: [{ bytes: Buffer.from("shot"), mime: "image/png", label: "image" }] }));
  const next = make_tool("later", async () => { later += 1; return { status: "done", text: "later", view: null }; });
  const h = harness(async () => completed({ tool_calls: [tool_call("probe"), { ...tool_call("later"), index: 1, id: "p1" }] }), [probe, next]);
  h.session.model = { ...model, vision: true };
  h.session.store_images = async () => ["stored-shot"];
  h.session.hooks = gates(async () => { h.controller.abort(); return { kind: "aborted" }; });
  await run_turn_loop(h.session, h.messages);
  assert.equal(later, 0);
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool" && entry.name === "probe");
  assert.equal(step?.kind === "tool" && step.status, "done");
  assert.deepEqual(step?.kind === "tool" && step.images, [{ id: "stored-shot", label: "image" }]);
  assert.equal(ends(h.events).length, 1);
});

test("pre-hook Stop still prevents execution and does not fabricate a completed tool result", async () => {
  let executed = 0;
  const h = harness(async () => completed({ tool_calls: [tool_call("probe")] }), [make_tool("probe", async () => { executed += 1; return { status: "done", text: "no", view: null }; })]);
  h.session.hooks = { ...gates(async () => ({ kind: "done", result_text: "", runs: [] })), pre_tool: async () => { h.controller.abort(); return { kind: "aborted" }; } };
  await run_turn_loop(h.session, h.messages);
  assert.equal(executed, 0);
  assert.equal(h.events.filter((event) => event.type === "tool_end").length, 0);
  assert.equal(transcript(h.events).steps.some((step) => step.kind === "tool" && step.status === "done"), false);
  assert.equal(ends(h.events).length, 1);
});

test("the actual PostToolUse PowerShell runner can be stopped without losing a completed result", async () => {
  const marker = path.join(root, "post-entered.txt");
  await set_hooks({ global: [hook({ event: "PostToolUse", command: `Set-Content -LiteralPath '${ps_path(marker)}' -Value entered; Start-Sleep -Seconds 45` })], projects: {} });
  const h = harness(async () => completed({ tool_calls: [tool_call("probe")] }), [make_tool("probe", async () => ({ status: "done", text: "actual hook result", view: null }))]);
  h.session.project_root = root;
  h.session.hooks = turn_hooks({ chat_id: "c", turn_id: "m", cwd: root, project_path: "", mode: "auto", plan: false, agent: null, emit: h.session.emit, signal: h.controller.signal });
  const running = run_turn_loop(h.session, h.messages);
  try {
    const deadline = Date.now() + 10000;
    while (!(await fs.stat(marker).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; }))) {
      assert.ok(Date.now() < deadline, "the real post hook did not enter");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    h.controller.abort(new Error("the user stopped the real post hook"));
    await running;
    const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
    assert.equal(step?.kind === "tool" && step.status, "done");
    assert.equal(step?.kind === "tool" && step.result_text, "actual hook result");
    assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  } finally {
    h.controller.abort();
    await running;
  }
});

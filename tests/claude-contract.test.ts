import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { channel_kind } from "../shared/ipc/index.ts";
import { claude_plan_serves } from "../electron/billing/claude.ts";
import { claude_runtime, set_claude_runtime, type ClaudeQuery, type ClaudeRuntime } from "../electron/claude/runtime.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";
import type { SecretCodec } from "../electron/storage/secrets.ts";

const codec: SecretCodec = {
  available: () => true,
  encrypt: (plain) => plain,
  decrypt: (cipher) => cipher,
};

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-contract-"));
  const dir = path.join(root, "v2");
  await fs.mkdir(dir, { recursive: true });
  await init_settings({
    files: { settings: path.join(dir, "settings.json"), secrets: path.join(dir, "secrets.json"), legacy_settings: path.join(root, "settings.json") },
    codec,
    on_change: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const empty_prompt: AsyncIterable<SDKUserMessage> = {
  [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
};

const options: Options = {};

test("claude_plan_serves needs the Claude plan switch and a Claude Code id on the model", async () => {
  try {
    await update_settings({ claude_billing: "api" });
    assert.equal(claude_plan_serves({ claude_code: "claude-opus-5-5" }), false);
    assert.equal(claude_plan_serves({}), false);
    await update_settings({ claude_billing: "claude" });
    assert.equal(claude_plan_serves({ claude_code: "claude-opus-5-5" }), true);
    assert.equal(claude_plan_serves({}), false);
    await update_settings({ billing: "chatgpt" });
    assert.equal(claude_plan_serves({ claude_code: "claude-opus-5-5" }), true);
  } finally {
    await update_settings({ billing: "api", claude_billing: "api" });
  }
});

test("the unwired Claude runtime refuses to open a query or delete a session and knows no usage limit texts", async () => {
  const runtime = claude_runtime();
  assert.throws(() => runtime.open({ prompt: empty_prompt, options }), /the Claude runtime is not wired/);
  await assert.rejects(runtime.delete_session("session", root), /the Claude runtime is not wired/);
  assert.deepEqual(runtime.usage_limit_prefixes, []);
  assert.equal(runtime.auth_failed(), undefined);
});

test("set_claude_runtime replaces the runtime until the next call", () => {
  const initial = claude_runtime();
  const opened: unknown[] = [];
  const query = { interrupt: async () => undefined, close: () => undefined, exited: Promise.resolve(), stderr_tail: () => "" } as unknown as ClaudeQuery;
  const wired: ClaudeRuntime = {
    open: (input) => {
      opened.push(input);
      return query;
    },
    delete_session: async () => undefined,
    usage_limit_prefixes: ["You've hit your"],
    auth_failed: () => undefined,
  };
  set_claude_runtime(wired);
  try {
    assert.equal(claude_runtime(), wired);
    assert.equal(claude_runtime().open({ prompt: empty_prompt, options }), query);
    assert.equal(opened.length, 1);
  } finally {
    set_claude_runtime(initial);
  }
  assert.equal(claude_runtime(), initial);
});

test("the Claude account channels are declared with their kinds", () => {
  assert.equal(channel_kind("claude:status"), "invoke");
  assert.equal(channel_kind("claude:refresh"), "invoke");
  assert.equal(channel_kind("claude:changed"), "event");
});

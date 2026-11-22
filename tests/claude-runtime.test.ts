import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { claude_env } from "../electron/claude/env.ts";
import { kill_claude_children, spawn_claude, stderr_tail_of } from "../electron/claude/process.ts";
import { create_claude_runtime } from "../electron/claude/query.ts";

const fake_source = `import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const picked = ["VX_BASE", "VX_SHARED", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_STARTUP_FAILURE_RESULTS", "CLAUDECODE", "ANTHROPIC_API_KEY"];
writeFileSync(process.env.VX_REPORT, JSON.stringify({ env: Object.fromEntries(picked.map((name) => [name, process.env[name] ?? null])), args: process.argv.slice(2) }));
process.stderr.write("fake claude started\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.type !== "control_request") {
    return;
  }
  send({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: {} } });
  if (frame.request.subtype === "initialize") {
    send({ type: "system", subtype: "init", session_id: "fake-session", uuid: "00000000-0000-4000-8000-000000000001" });
  }
});
lines.on("close", () => {
  process.stderr.write("fake claude stdin closed\\n");
  process.exit(0);
});
`;

let root = "";
let fake = "";
let config_dir = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-runtime-"));
  fake = path.join(root, "fake-claude.mjs");
  config_dir = path.join(root, "claude-config");
  await fs.mkdir(config_dir);
  await fs.writeFile(fake, fake_source);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const idle_input = () => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const messages = async function* (): AsyncGenerator<SDKUserMessage, void> {
    await released;
  };
  return { prompt: messages(), release };
};

test("open runs the configured executable with the merged env, yields its messages, and close ends the iteration and the child", async () => {
  const report = path.join(root, "report.json");
  const runtime = create_claude_runtime({
    executable: () => fake,
    env: () => ({ ...claude_env(), CLAUDE_CONFIG_DIR: config_dir, VX_BASE: "from base", VX_SHARED: "from base" }),
    auth_failed: () => {},
  });
  const input = idle_input();
  const running = runtime.open({ prompt: input.prompt, options: { env: { VX_SHARED: "from options", VX_REPORT: report } } });
  const messages = running[Symbol.asyncIterator]();
  try {
    const first = await messages.next();
    assert.equal(first.done, false);
    const message = first.value as SDKMessage;
    assert.deepEqual([message.type, message.type === "system" ? message.session_id : null], ["system", "fake-session"]);
    const seen = JSON.parse(await fs.readFile(report, "utf8")) as { env: Record<string, string | null>; args: string[] };
    assert.deepEqual(seen.env, {
      VX_BASE: "from base",
      VX_SHARED: "from options",
      CLAUDE_CONFIG_DIR: config_dir,
      CLAUDE_CODE_ENTRYPOINT: "vantheax",
      CLAUDE_CODE_STARTUP_FAILURE_RESULTS: "1",
      CLAUDECODE: null,
      ANTHROPIC_API_KEY: null,
    });
    assert.ok(seen.args.includes("stream-json"), seen.args.join(" "));
    running.close();
    let ended = false;
    try {
      while (!(await messages.next()).done) {
        continue;
      }
      ended = true;
    } catch (error) {
      ended = error instanceof Error;
    }
    assert.equal(ended, true);
    await running.exited;
    assert.match(running.stderr_tail(), /fake claude started/);
  } finally {
    input.release();
  }
});

test("open throws when the executable cannot be found and exposes the SDK usage limit prefixes", () => {
  const runtime = create_claude_runtime({
    executable: () => {
      throw new Error("the Claude Code executable is missing at C:\\nowhere\\claude.exe");
    },
    env: () => ({}),
    auth_failed: () => {},
  });
  const input = idle_input();
  assert.throws(() => runtime.open({ prompt: input.prompt, options: {} }), /missing at C:\\nowhere\\claude\.exe/);
  input.release();
  assert.ok(runtime.usage_limit_prefixes.includes("You've hit your"));
});

test("spawn_claude keeps the last 2048 characters of stderr after the child closed", async () => {
  const noisy = spawn_claude({ command: process.execPath, args: ["-e", "process.stderr.write('a'.repeat(3000) + 'END')"], env: { ...process.env } });
  noisy.stdin.end();
  await new Promise((resolve) => noisy.once("close", resolve));
  const tail = stderr_tail_of(noisy);
  assert.equal(tail.length, 2048);
  assert.ok(tail.endsWith("aEND"));
});

test("kill_claude_children ends every live child at once", async () => {
  const waiting = [0, 1].map(() => spawn_claude({ command: process.execPath, args: ["-e", "process.stdin.resume()"], env: { ...process.env } }));
  const exits = waiting.map((child) => new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code))));
  kill_claude_children();
  for (const code of await Promise.all(exits)) {
    assert.notEqual(code, 0);
  }
  assert.ok(waiting.every((child) => child.killed));
});

test("auth_failed is the injected callback and delete_session logs a missing session instead of rejecting", async (t) => {
  const error = t.mock.method(console, "error", () => {});
  let failed = 0;
  const runtime = create_claude_runtime({ executable: () => fake, env: () => ({}), auth_failed: () => (failed += 1) });
  runtime.auth_failed();
  assert.equal(failed, 1);
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config_dir;
  try {
    await runtime.delete_session("00000000-0000-4000-8000-0000000000ff", root);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previous;
    }
  }
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0]?.arguments[0]), /deleting the Claude Code session 00000000-0000-4000-8000-0000000000ff of /);
});

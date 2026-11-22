import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import type { AssistantMessage, Chat, ChatMeta, Message } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { BillingMode, ClaudeBillingMode } from "../shared/settings.ts";
import type { ClaudeRuntime, ClaudeSessionRef } from "../electron/claude/runtime.ts";
import type { Launched } from "../electron/turn/run.ts";
import type { FakeRuntime } from "./claude-turn-kit.ts";
import type * as Kit from "./claude-turn-kit.ts";
import { assistant_message, chat_dirs_in, user_message } from "./fixtures/legacy/harness.ts";

const stubs: Record<string, string> = {
  electron: "module.exports = { app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() }, ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] } };",
  provider: [
    "export const routed = [];",
    "export const stream_model = async (request, callbacks) => {",
    "  routed.push(request.model.id);",
    "  callbacks.on_text('plain answer');",
    "  return { status: 'completed', content: 'plain answer', reasoning: '', reasoning_details: [], tool_calls: [], finish_reason: 'stop', usage: null };",
    "};",
    "export const complete_model = async () => { throw new Error('complete_model is not part of the routing test'); };",
  ].join("\n"),
  title: "export const start_title = () => {};",
};

const routing_stubs: Plugin = {
  name: "routing-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]model[\\/]provider\.ts$|^\.\/provider\.ts$/ }, () => ({ path: "provider", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]side[\\/]title\.ts$/ }, () => ({ path: "title", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

const exports = [
  'export { compact_turn, launch_internal_turn } from "./electron/turn/run.ts";',
  'export { append_message, create_chat, flush_all_sync, get_chat, init_chats } from "./electron/chats/store.ts";',
  'export { chat_root } from "./electron/chats/workspace.ts";',
  'export { claude_session_of, set_claude_session } from "./electron/chats/claude-session.ts";',
  'export { set_storage_root } from "./electron/storage/paths.ts";',
  'export { init_media } from "./electron/media/files.ts";',
  'export { init_settings, update_settings } from "./electron/settings/store.ts";',
  'export { set_claude_runtime } from "./electron/claude/runtime.ts";',
  'export { routed } from "./electron/model/provider.ts";',
  'export { fake_runtime, init, result, settle, system, text_response, until } from "./tests/claude-turn-kit.ts";',
];

type Main = Pick<typeof Kit, "fake_runtime" | "init" | "result" | "settle" | "system" | "text_response" | "until"> & {
  compact_turn: (chat_id: string) => Promise<{ status: string }>;
  launch_internal_turn: (chat_id: string, origin: string, text: string, turn: { choice: { model: string; effort: string; pro: boolean }; watch?: (body: StreamEventBody) => void }) => Promise<Launched | null>;
  append_message: (chat_id: string, message: Message) => Promise<void>;
  create_chat: (project_path: string) => Promise<ChatMeta>;
  flush_all_sync: () => void;
  get_chat: (chat_id: string) => Promise<Chat | null>;
  init_chats: (options: unknown) => Promise<void>;
  chat_root: (chat: ChatMeta) => Promise<string>;
  claude_session_of: (chat_id: string) => Promise<ClaudeSessionRef | null>;
  set_claude_session: (chat_id: string, ref: ClaudeSessionRef | null) => Promise<void>;
  set_storage_root: (root: string) => void;
  init_media: (dirs: unknown) => void;
  init_settings: (options: unknown) => Promise<void>;
  update_settings: (patch: Record<string, unknown>) => Promise<unknown>;
  set_claude_runtime: (runtime: ClaudeRuntime) => void;
  routed: string[];
};

const gpt = "openai/gpt-6.2-sol";
const claude = "anthropic/claude-opus-5.5";
const other = "deepseek/deepseek-v4.1-flash-1017";

const bundle_url = pathToFileURL(path.join(process.cwd(), "tests", "claude-routing.bundle.js")).href;

let main: Main;
let root = "";
let project = "";
let fake: FakeRuntime;

before(async () => {
  const built = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [routing_stubs],
    external: ["@anthropic-ai/claude-agent-sdk"],
    define: { "import.meta.url": JSON.stringify(bundle_url) },
    banner: { js: `import { createRequire as bundle_require } from "node:module"; const require = bundle_require(${JSON.stringify(bundle_url)});` },
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64"));
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-routing-"));
  project = path.join(root, "project");
  await fs.mkdir(project);
  main.set_storage_root(root);
  const media = { attachments: path.join(root, "v2", "media", "attachments"), images: path.join(root, "v2", "media", "images") };
  await fs.mkdir(media.attachments, { recursive: true });
  await fs.mkdir(media.images, { recursive: true });
  main.init_media(media);
  await main.init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher },
    on_change: () => undefined,
  });
  await main.init_chats({
    dirs: chat_dirs_in(root),
    legacy_root: path.join(root, "no-legacy"),
    events: { changed: () => {}, removed: () => {}, appended: () => {}, truncated: () => {}, questions: () => {} },
  });
  fake = main.fake_runtime();
  main.set_claude_runtime(fake.runtime);
});

after(async () => {
  main?.flush_all_sync();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const switches = async (billing: BillingMode, claude_billing: ClaudeBillingMode) => {
  await main.update_settings({ billing, claude_billing });
};

const turn_message = async (chat_id: string, message_id: string): Promise<AssistantMessage> => {
  const message = (await main.get_chat(chat_id))?.messages.find((entry) => entry.id === message_id);
  assert.ok(message && message.role === "assistant");
  return message;
};

const run_turn = async (model: string, answer: (opened: number) => Promise<void>) => {
  const meta = await main.create_chat(project);
  const before = { routed: main.routed.length, opened: fake.queries.length };
  const launched = await main.launch_internal_turn(meta.id, "user", "hello there", { choice: { model, effort: "", pro: false } });
  assert.ok(launched);
  await answer(before.opened);
  await launched.finished;
  return { chat_id: meta.id, message: await turn_message(meta.id, launched.started.message_id), routed: main.routed.length - before.routed, opened: fake.queries.length - before.opened };
};

const answer_claude = async (opened: number) => {
  const query = await fake.opened(opened + 1);
  const system = query.options.systemPrompt;
  assert.ok(typeof system === "object" && !Array.isArray(system) && system.type === "custom");
  assert.match([system.prompt].flat().join("\n"), /The application adds system reminders to this conversation\./);
  assert.equal(query.options.model, "claude-opus-5-5");
  await query.next_push();
  query.send(main.init("sess-routing"), ...main.text_response("m1", "claude answer"), main.result());
};

test("each combination of the two billing switches sends only Claude models on the Claude plan through Claude Code", async () => {
  try {
    for (const billing of ["api", "chatgpt"] as const) {
      for (const claude_billing of ["api", "claude"] as const) {
        await switches(billing, claude_billing);
        for (const model of [gpt, claude, other]) {
          const through_claude = claude_billing === "claude" && model === claude;
          const ran = await run_turn(model, through_claude ? answer_claude : async () => undefined);
          const label = `${model} with billing ${billing} and claude_billing ${claude_billing}`;
          assert.equal(ran.message.status, "done", label);
          assert.deepEqual([ran.opened, ran.routed], through_claude ? [1, 0] : [0, 1], label);
          const text = ran.message.steps.flatMap((step) => (step.kind === "text" ? [step.text] : [])).join("");
          assert.equal(text, through_claude ? "claude answer" : "plain answer", label);
          assert.equal((await main.claude_session_of(ran.chat_id))?.session_id ?? null, through_claude ? "sess-routing" : null, label);
        }
      }
    }
  } finally {
    await switches("api", "api");
  }
});

test("a Claude Code process that does not start ends the turn with its own error and never reaches OpenRouter", async () => {
  await switches("api", "claude");
  fake.open_error = new Error("spawn claude.exe ENOENT");
  try {
    const ran = await run_turn(claude, async () => undefined);
    assert.equal(ran.message.status, "failed");
    assert.equal(ran.message.error?.kind, "claude_process");
    assert.deepEqual([ran.opened, ran.routed], [0, 0]);
  } finally {
    fake.open_error = null;
    await switches("api", "api");
  }
});

test("compact_turn answers nothing for a Claude-plan chat without a resumable session and compacts through Claude Code once one exists", async () => {
  await switches("api", "claude");
  try {
    const meta = await main.create_chat(project);
    await main.append_message(meta.id, user_message("u1", "look around"));
    await main.append_message(meta.id, { ...assistant_message("a1", "looked"), model: claude });
    const opened = fake.queries.length;
    const routed = main.routed.length;
    assert.deepEqual(await main.compact_turn(meta.id), { status: "nothing" });
    const cwd = await main.chat_root(meta);
    await main.set_claude_session(meta.id, { session_id: "sess-stale", cwd, through_message_id: "older-turn" });
    assert.deepEqual(await main.compact_turn(meta.id), { status: "nothing" });
    assert.equal(fake.queries.length, opened);
    await main.set_claude_session(meta.id, { session_id: "sess-compact", cwd, through_message_id: "a1" });
    const compacted = main.compact_turn(meta.id);
    const query = await fake.opened(opened + 1);
    assert.equal(query.options.resume, "sess-compact");
    const command = await query.next_push();
    assert.equal(command.message.content, "/compact");
    query.send(
      main.init("sess-compact"),
      main.system("status", { status: "compacting" }),
      main.system("compact_boundary", { compact_metadata: { trigger: "manual", pre_tokens: 1000, post_tokens: 100 } }),
      main.result({ result: "", num_turns: 0 }),
    );
    assert.deepEqual(await compacted, { status: "done" });
    assert.equal(main.routed.length, routed);
  } finally {
    await switches("api", "api");
  }
});

test("a turn started while the ended Claude turn's process still exits waits for that exit instead of being refused", async () => {
  await switches("api", "claude");
  let release: () => void = () => undefined;
  fake.exit_hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const meta = await main.create_chat(project);
    const opened = fake.queries.length;
    const choice = { model: claude, effort: "", pro: false };
    let ended = false;
    const first = await main.launch_internal_turn(meta.id, "user", "first", { choice, watch: (body) => void (ended ||= body.type === "end") });
    assert.ok(first);
    const query = await fake.opened(opened + 1);
    await query.next_push();
    query.send(main.init("sess-exit"), ...main.text_response("m1", "first answer"), main.result());
    await main.until(() => ended, "end of the first turn");
    let second_started = false;
    const second = main.launch_internal_turn(meta.id, "user", "second", { choice }).then((launched) => {
      second_started = true;
      return launched;
    });
    await main.settle();
    assert.equal(second_started, false);
    release();
    await first.finished;
    const launched = await second;
    assert.ok(launched);
    await answer_claude(opened + 1);
    await launched.finished;
    assert.equal((await turn_message(meta.id, launched.started.message_id)).status, "done");
    assert.equal(fake.queries[opened + 1]?.options.resume, "sess-exit");
  } finally {
    release();
    fake.exit_hold = null;
    await switches("api", "api");
  }
});

test("a resumed Claude turn after a failed turn opens with the note about that failure", async () => {
  await switches("api", "claude");
  try {
    const meta = await main.create_chat(project);
    await main.append_message(meta.id, user_message("u1", "build it"));
    await main.append_message(meta.id, { ...assistant_message("a1", "half done", "failed"), model: claude, error: { kind: "claude_limit", message: "You've hit your limit" } });
    await main.set_claude_session(meta.id, { session_id: "sess-failed", cwd: await main.chat_root(meta), through_message_id: "a1" });
    const opened = fake.queries.length;
    const launched = await main.launch_internal_turn(meta.id, "user", "go on", { choice: { model: claude, effort: "", pro: false } });
    assert.ok(launched);
    const query = await fake.opened(opened + 1);
    assert.equal(query.options.resume, "sess-failed");
    const opening = await query.next_push();
    assert.deepEqual(opening.message.content, [
      { type: "text", text: "[The previous turn failed: You've hit your limit.]" },
      { type: "text", text: "go on" },
    ]);
    query.send(main.init("sess-failed"), ...main.text_response("m1", "continued"), main.result());
    await launched.finished;
    assert.equal((await turn_message(meta.id, launched.started.message_id)).status, "done");
  } finally {
    await switches("api", "api");
  }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import type { AssistantMessage, ChatMeta, ToolStep } from "../shared/chat.ts";
import type { AskQuestion } from "../shared/questions.ts";
import type { Settings } from "../shared/settings.ts";
import { forget_run_options, reject_feedback, run_options, set_run_options, type RunOptions } from "../electron/turn/run-options.ts";
import { assistant_message, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

const stubs: Record<string, string> = {
  electron:
    "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() }; export const ipcMain = { handle() {}, on() {} }; export const Menu = {}; export const BrowserWindow = class {}; export const shell = {}; export const nativeImage = {};",
  drive: "export const drive = async () => {};",
  title: "export const start_title = () => {};",
};

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]side[\\/]title\.ts$/ }, () => ({ path: "title", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

const exports = [
  'export { accept_plan, continue_turn, launch_internal_turn } from "./electron/turn/run.ts";',
  'export { set_run_options, forget_run_options } from "./electron/turn/run-options.ts";',
  'export { answer_questions } from "./electron/questions/deliver.ts";',
  'export { answer_request } from "./electron/questions/answers.ts";',
  'export { append_message, create_chat, flush_all_sync, get_chat, init_chats } from "./electron/chats/store.ts";',
  'export { set_storage_root } from "./electron/storage/paths.ts";',
  'export { init_settings, update_settings } from "./electron/settings/store.ts";',
];

let main: any;
let root = "";

const pinned: RunOptions = { mode: "full", choice: { model: "anthropic/claude-haiku-5.5", effort: "low", pro: false }, approvals: "reject" };

const runner: AskQuestion = { title: "Which runner?", options: ["node --test", "vitest"] };

const asked = (id: string): AssistantMessage => {
  const step: ToolStep = {
    id: "tool:0:c0_0",
    round: 0,
    kind: "tool",
    index: 0,
    call_id: "c0_0",
    name: "ask_user",
    args: { questions: [runner] },
    status: "done",
    progress: null,
    approval: null,
    view: { kind: "questions", questions: [runner] },
    error: null,
    result_text: "shown",
    started_at: 1,
    ended_at: 2,
  };
  return { ...assistant_message(id, ""), steps: [step] };
};

const worked_chat = async (last: AssistantMessage = assistant_message("a1", "looked")): Promise<string> => {
  const meta: ChatMeta = await main.create_chat("");
  await main.append_message(meta.id, user_message("u1", "look around"));
  await main.append_message(meta.id, last);
  return meta.id;
};

const newest_turn = async (chat_id: string): Promise<AssistantMessage> => {
  const chat = await main.get_chat(chat_id);
  const message = chat.messages.at(-1);
  assert.equal(message?.role, "assistant");
  return message;
};

before(async () => {
  const result = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [main_stubs],
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  root = await make_root("vx-run-options-");
  main.set_storage_root(root);
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
});

after(async () => {
  main?.flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

test("run options are kept per chat until they are forgotten", () => {
  assert.equal(run_options("chat-a"), null);
  set_run_options("chat-a", pinned);
  set_run_options("chat-b", { ...pinned, approvals: "client" });
  assert.deepEqual(run_options("chat-a"), pinned);
  assert.equal(run_options("chat-b")?.approvals, "client");
  forget_run_options("chat-a");
  assert.equal(run_options("chat-a"), null);
  assert.equal(run_options("chat-b")?.approvals, "client");
  forget_run_options("chat-b");
  assert.equal(reject_feedback, "This run has no one to approve actions, so the request was rejected. Continue without this action.");
});

test("follow-up turns of a pinned chat use the pinned mode and model instead of the settings", async () => {
  const plain = await worked_chat();
  await main.continue_turn(plain);
  const unpinned = await newest_turn(plain);
  assert.equal(unpinned.mode, "auto");
  assert.notEqual(unpinned.model, pinned.choice.model);
  const starts: [string, (chat_id: string) => Promise<unknown>][] = [
    ["continue", (chat_id) => main.continue_turn(chat_id)],
    ["plan", (chat_id) => main.accept_plan(chat_id, "a1")],
    ["report", (chat_id) => main.launch_internal_turn(chat_id, "agent_report", "agent finished")],
  ];
  for (const [name, start] of starts) {
    const chat_id = await worked_chat();
    main.set_run_options(chat_id, pinned);
    try {
      assert.ok(await start(chat_id), `${name} did not start a turn`);
      const turn = await newest_turn(chat_id);
      assert.deepEqual([turn.mode, turn.model, turn.effort], ["full", "anthropic/claude-haiku-5.5", "low"], name);
      assert.deepEqual((await main.get_chat(chat_id)).choice, pinned.choice, name);
    } finally {
      main.forget_run_options(chat_id);
    }
  }
});

test("an explicit internal turn choice and mode still win over the pinned options", async () => {
  const chat_id = await worked_chat();
  main.set_run_options(chat_id, pinned);
  try {
    const choice = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "high", pro: false };
    assert.ok(await main.launch_internal_turn(chat_id, "scheduled", "scheduled run", { choice, mode: "ask" }));
    const turn = await newest_turn(chat_id);
    assert.deepEqual([turn.mode, turn.model, turn.effort], ["ask", "deepseek/deepseek-v4.1-flash-1017", "high"]);
  } finally {
    main.forget_run_options(chat_id);
  }
});

test("an answer request takes model, effort, tier and mode from the pinned options", async () => {
  const chat_id = await worked_chat();
  const settings = { model: "x/model", effort: "high", mode: "ask" } as Settings;
  const chat = { ...(await main.get_chat(chat_id)), choice: { model: "openai/gpt-6.1-sol", effort: "xhigh", pro: true, tier: "flex" } };
  const request = main.answer_request(chat, "t", settings, { mode: "full", choice: { model: "anthropic/claude-haiku-5.5", effort: "low", pro: false, tier: "fast" } });
  assert.deepEqual([request.model, request.effort, request.pro, request.tier, request.mode], ["anthropic/claude-haiku-5.5", "low", false, "fast", "full"]);
  const untiered = main.answer_request(chat, "t", settings, { mode: "auto", choice: { model: "anthropic/claude-haiku-5.5", effort: "low", pro: false } });
  assert.equal("tier" in untiered, false);
  const unpinned = main.answer_request(chat, "t", settings);
  assert.deepEqual([unpinned.model, unpinned.effort, unpinned.pro, unpinned.tier, unpinned.mode], ["openai/gpt-6.1-sol", "xhigh", true, "flex", "ask"]);
});

test("answering a question with no running turn starts the new turn with the pinned options", async () => {
  const chat_id = await worked_chat(asked("a1"));
  main.set_run_options(chat_id, pinned);
  try {
    await main.answer_questions(chat_id, [{ id: "a1:c0_0:0", answer: "vitest" }]);
    const chat = await main.get_chat(chat_id);
    const user = chat.messages.at(-2);
    assert.equal(user?.role, "user");
    assert.match(user.text, /vitest/);
    const turn = await newest_turn(chat_id);
    assert.deepEqual([turn.mode, turn.model, turn.effort], ["full", "anthropic/claude-haiku-5.5", "low"]);
  } finally {
    main.forget_run_options(chat_id);
  }
});

test("with ChatGPT plan billing an unpinned answer turn keeps the model it gets with API billing and pinned options stay", async () => {
  const api_chat = await worked_chat(asked("a1"));
  await main.answer_questions(api_chat, [{ id: "a1:c0_0:0", answer: "vitest" }]);
  const api_model = (await newest_turn(api_chat)).model;
  assert.equal(api_model, "deepseek/deepseek-v4.1-flash-1017");
  await main.update_settings({ billing: "chatgpt" });
  try {
    const plan_chat = await worked_chat(asked("a1"));
    await main.answer_questions(plan_chat, [{ id: "a1:c0_0:0", answer: "vitest" }]);
    assert.equal((await newest_turn(plan_chat)).model, api_model);
    const starts: [string, () => Promise<string>, (chat_id: string) => Promise<unknown>][] = [
      ["continue", () => worked_chat(), (chat_id) => main.continue_turn(chat_id)],
      ["plan", () => worked_chat(), (chat_id) => main.accept_plan(chat_id, "a1")],
      ["report", () => worked_chat(), (chat_id) => main.launch_internal_turn(chat_id, "agent_report", "agent finished")],
      ["answer", () => worked_chat(asked("a1")), (chat_id) => main.answer_questions(chat_id, [{ id: "a1:c0_0:0", answer: "vitest" }])],
    ];
    for (const [name, make, start] of starts) {
      const chat_id = await make();
      main.set_run_options(chat_id, pinned);
      try {
        await start(chat_id);
        const turn = await newest_turn(chat_id);
        assert.deepEqual([turn.mode, turn.model, turn.effort], ["full", "anthropic/claude-haiku-5.5", "low"], name);
      } finally {
        main.forget_run_options(chat_id);
      }
    }
  } finally {
    await main.update_settings({ billing: "api" });
  }
});

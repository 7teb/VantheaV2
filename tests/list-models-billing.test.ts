import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import type { ModelCatalog } from "../shared/models.ts";
import type { ModelPrice } from "../shared/tool-view.ts";
import type { Tool, ToolContext } from "../electron/tools/types.ts";

const electron_stub = "module.exports = { app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() } };";

const bundle_url = pathToFileURL(path.join(process.cwd(), "tests", "list-models-billing.bundle.js")).href;

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: electron_stub, loader: "js" }));
  },
};

const exports = [
  'export { find_tool } from "./electron/tools/registry.ts";',
  'export { model_catalog } from "./electron/model/catalog-file.ts";',
  'export { set_key_source } from "./electron/model/key.ts";',
  'export { init_settings, update_settings } from "./electron/settings/store.ts";',
];

let main: {
  find_tool: (name: string) => Tool | null;
  model_catalog: () => Promise<ModelCatalog>;
  set_key_source: (source: () => string) => void;
  init_settings: (options: unknown) => Promise<void>;
  update_settings: (patch: Record<string, unknown>) => Promise<unknown>;
};
let root = "";

before(async () => {
  const result = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [main_stubs],
    define: { "import.meta.url": JSON.stringify(bundle_url) },
    banner: { js: `import { createRequire as bundle_require } from "node:module"; const require = bundle_require(${JSON.stringify(bundle_url)});` },
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-chatgpt-list-models-"));
  await main.init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher },
    on_change: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const claude_ids = ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.2"];

const listed_rows = async (patch: Record<string, unknown>) => {
  const tool = main.find_tool("list_models");
  assert.ok(tool);
  main.set_key_source(() => "");
  await main.update_settings(patch);
  const fetched = mock.method(globalThis, "fetch", async () => {
    throw new Error("list_models must not reach the network without a key");
  });
  const warned = mock.method(console, "warn", () => undefined);
  try {
    const ctx = { signal: new AbortController().signal, project_root: root } as unknown as ToolContext;
    const result = await tool.execute(ctx, {});
    assert.equal(result.status, "done");
    assert.equal(fetched.mock.callCount(), 0);
    assert.ok(result.view && result.view.kind === "models");
    return { text: result.text, rows: new Map<string, ModelPrice>(result.view.models.map((row) => [row.id, row])) };
  } finally {
    fetched.mock.restore();
    warned.mock.restore();
    await main.update_settings({ billing: "api", claude_billing: "api" });
  }
};

test("list_models in plan billing marks the plan models and lists every other catalog model with the missing-key error", async () => {
  const tool = main.find_tool("list_models");
  assert.ok(tool);
  main.set_key_source(() => "");
  await main.update_settings({ billing: "chatgpt" });
  const fetched = mock.method(globalThis, "fetch", async () => {
    throw new Error("list_models must not reach the network without a key");
  });
  const warned = mock.method(console, "warn", () => undefined);
  try {
    const ctx = { signal: new AbortController().signal, project_root: root } as unknown as ToolContext;
    const result = await tool.execute(ctx, {});
    assert.equal(result.status, "done");
    assert.equal(fetched.mock.callCount(), 0);
    assert.ok(result.view && result.view.kind === "models");
    const rows = new Map<string, ModelPrice>(result.view.models.map((row) => [row.id, row]));
    for (const model of (await main.model_catalog()).models) {
      assert.ok(rows.has(model.id), model.id);
    }
    for (const id of ["openai/gpt-6.2-sol", "openai/gpt-6-luna"]) {
      assert.equal(rows.get(id)?.plan, true, id);
      assert.equal(rows.get(id)?.error, "", id);
    }
    for (const id of ["deepseek/deepseek-v4.1-flash-1017", "anthropic/claude-opus-5.5", "openai/gpt-oss-120b"]) {
      assert.equal(rows.get(id)?.plan, undefined, id);
      assert.match(rows.get(id)?.error ?? "", /No OpenRouter API key/, id);
    }
    assert.equal(rows.has("openai/gpt-6.1-sol:floor"), false);
    assert.match(rows.get("google/gemini-4-argon:floor")?.error ?? "", /No OpenRouter API key/);
    assert.match(result.text, /included in the ChatGPT plan/);
  } finally {
    fetched.mock.restore();
    warned.mock.restore();
    await main.update_settings({ billing: "api" });
  }
});

test("list_models with the Claude plan marks the Claude models as included and lists every other model with the missing-key error", async () => {
  const { text, rows } = await listed_rows({ claude_billing: "claude" });
  for (const model of (await main.model_catalog()).models) {
    assert.ok(rows.has(model.id), model.id);
  }
  for (const id of claude_ids) {
    const row = rows.get(id);
    assert.equal(row?.claude_plan, true, id);
    assert.equal(row?.plan, undefined, id);
    assert.equal(row?.error, "", id);
    assert.equal(row?.input, null, id);
    assert.equal(row?.endpoint, "", id);
  }
  for (const id of ["deepseek/deepseek-v4.1-flash-1017", "openai/gpt-6.2-sol", "openai/gpt-oss-120b"]) {
    assert.equal(rows.get(id)?.claude_plan, undefined, id);
    assert.equal(rows.get(id)?.plan, undefined, id);
    assert.match(rows.get(id)?.error ?? "", /No OpenRouter API key/, id);
  }
  assert.match(text, /^Models \(prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to; models marked as included in the Claude plan have no per-token price\):\n/);
  assert.match(text, /\nanthropic\/claude-opus-5\.5 \| Claude Opus 5\.5 \| Anthropic \| included in the Claude plan, no per-token price \| context 1000000 \| efforts low, medium, high, xhigh, max\n/);
  assert.doesNotMatch(text, /ChatGPT plan/);
});

test("list_models with both plans keeps the ChatGPT rows as they are and names both plans in the header", async () => {
  const { text, rows } = await listed_rows({ billing: "chatgpt", claude_billing: "claude" });
  for (const id of ["openai/gpt-6.2-sol", "openai/gpt-6-luna"]) {
    assert.equal(rows.get(id)?.plan, true, id);
    assert.equal(rows.get(id)?.claude_plan, undefined, id);
    assert.equal(rows.get(id)?.error, "", id);
  }
  for (const id of claude_ids) {
    assert.equal(rows.get(id)?.claude_plan, true, id);
    assert.equal(rows.get(id)?.plan, undefined, id);
  }
  for (const id of ["deepseek/deepseek-v4.1-flash-1017", "openai/gpt-oss-120b"]) {
    assert.match(rows.get(id)?.error ?? "", /No OpenRouter API key/, id);
  }
  assert.match(text, /^Models \(prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to; models marked as included in the ChatGPT plan or the Claude plan have no per-token price\):\n/);
  assert.match(text, /\nopenai\/gpt-6-luna \| [^\n]* \| included in the ChatGPT plan, no per-token price \| context /);
  assert.match(text, /\nanthropic\/claude-haiku-5\.5 \| Claude Haiku 5\.5 \| Anthropic \| included in the Claude plan, no per-token price \| context /);
});

test("the list_models description keeps the ChatGPT sentence and adds the Claude plan sentence", () => {
  const description = main.find_tool("list_models")?.spec.description ?? "";
  assert.match(description, /When the app bills through a ChatGPT plan, the OpenAI models the plan serves are marked as included in the plan without a price, and every other model runs through OpenRouter at the listed price\./);
  assert.match(description, /When the app bills Claude models through a Claude plan, those models are marked as included in the Claude plan without a price\.$/);
});

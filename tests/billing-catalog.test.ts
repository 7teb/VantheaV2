import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import type { ModelCatalog, ModelEntry } from "../shared/models.ts";
import { plan_eligible } from "../electron/model/catalog.ts";

const electron_stub =
  "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() }; export const ipcMain = { handle() {}, on() {} }; export const Menu = {}; export const BrowserWindow = class {}; export const shell = {}; export const nativeImage = {};";

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: electron_stub, loader: "js" }));
  },
};

const exports = [
  'export { billing_catalog } from "./electron/billing/catalog.ts";',
  'export { model_catalog } from "./electron/model/catalog-file.ts";',
  'export { init_settings, update_settings } from "./electron/settings/store.ts";',
];

let main: {
  billing_catalog: () => Promise<ModelCatalog>;
  model_catalog: () => Promise<ModelCatalog>;
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
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-chatgpt-billing-catalog-"));
  await main.init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher },
    on_change: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const ids = (models: readonly ModelEntry[]) => models.map((model) => model.id);

test("API billing hands out the catalog object itself", async () => {
  assert.equal(await main.billing_catalog(), await main.model_catalog());
});

test("ChatGPT billing keeps every catalog model in catalog order and marks every plan eligible id while the account list is unknown", async () => {
  await main.update_settings({ billing: "chatgpt" });
  try {
    const shipped = await main.model_catalog();
    const plan = await main.billing_catalog();
    assert.deepEqual(ids(plan.models), ids(shipped.models));
    for (const id of ["deepseek/deepseek-v4.1-flash-1017", "anthropic/claude-opus-5.5", "openai/gpt-oss-120b"]) {
      const entry = plan.models.find((model) => model.id === id);
      assert.ok(entry, id);
      assert.equal(entry, shipped.models.find((model) => model.id === id), id);
    }
    const eligible = shipped.models.filter((model) => plan_eligible(model));
    assert.ok(eligible.length > 0);
    assert.deepEqual(
      plan.plan_ids,
      eligible.flatMap((model) => [model.id, ...(model.pro ? [model.pro.id] : [])]),
    );
    assert.equal(plan.plan_ids?.includes("openai/gpt-oss-120b"), false);
    assert.equal(plan.side, shipped.side);
  } finally {
    await main.update_settings({ billing: "api" });
  }
});

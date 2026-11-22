import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import type { ClaudeAccount } from "../shared/claude.ts";
import type { ModelCatalog } from "../shared/models.ts";

const stubs: Record<string, string> = {
  electron:
    "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() }; export const ipcMain = { handle() {}, on() {} }; export const Menu = {}; export const BrowserWindow = class {}; export const shell = { openExternal: async () => {} }; export const nativeImage = {};",
  sdk: 'export const query = () => { throw new Error("query is not used in this test"); }; export const deleteSession = async () => {}; export const USAGE_LIMIT_ERROR_PREFIXES = ["stub usage limit"];',
  [path.resolve("electron/claude/process.ts")]: [
    "export const process_calls = { runs: [], kills: 0 };",
    'export const spawn_claude = () => { throw new Error("spawn_claude is not used in this test"); };',
    'export const stderr_tail_of = () => "";',
    'export const run_claude = async (args) => { process_calls.runs.push(args); return { code: 1, stdout: "", stderr: "" }; };',
    "export const kill_claude_children = () => { process_calls.kills += 1; };",
  ].join("\n"),
  [path.resolve("electron/claude/executable.ts")]: 'export const claude_executable = () => "C:/stub/claude.exe";',
};

const wire_stubs: Plugin = {
  name: "wire-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: "sdk", namespace: "stub" }));
    builder.onResolve({ filter: /(process|executable)\.ts$/ }, (args) => {
      const target = path.resolve(args.resolveDir, args.path);
      return Object.hasOwn(stubs, target) ? { path: target, namespace: "stub" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

const exports = [
  'export { init_billing, shutdown_billing, wire_billing } from "./electron/billing/wire.ts";',
  'export { init_settings, update_settings } from "./electron/settings/store.ts";',
  'export { set_storage_root } from "./electron/storage/paths.ts";',
  'export { add_event_tap } from "./electron/ipc/handle.ts";',
  'export { claude_runtime } from "./electron/claude/runtime.ts";',
  'export { claude_account } from "./electron/claude/service.ts";',
  'export { process_calls } from "./electron/claude/process.ts";',
];

type Emitted = { name: string; payload: unknown };

let main: {
  init_billing: () => Promise<void>;
  shutdown_billing: () => void;
  wire_billing: () => void;
  init_settings: (options: unknown) => Promise<void>;
  update_settings: (patch: Record<string, unknown>) => Promise<unknown>;
  set_storage_root: (root: string) => unknown;
  add_event_tap: (tap: (target: string | null, name: string, payload: unknown) => void) => () => void;
  claude_runtime: () => { usage_limit_prefixes: readonly string[]; auth_failed: () => void };
  claude_account: () => ClaudeAccount;
  process_calls: { runs: string[][]; kills: number };
};
let root = "";
let remove_tap = () => {};
const emitted: Emitted[] = [];
const waiters: { name: string; resolve: (payload: unknown) => void }[] = [];

const next_event = <T>(name: string): Promise<T> =>
  new Promise((resolve) => {
    waiters.push({ name, resolve: (payload) => resolve(payload as T) });
  });

const published = () => emitted.filter((entry) => entry.name === "models:changed").map((entry) => entry.payload as ModelCatalog);

const claude_ids = ["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.2"];

before(async () => {
  const result = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [wire_stubs],
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-billing-wire-"));
  await main.init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher },
    on_change: () => undefined,
  });
  main.set_storage_root(root);
  remove_tap = main.add_event_tap((_target, name, payload) => {
    if (name !== "models:changed" && name !== "claude:changed") {
      return;
    }
    emitted.push({ name, payload });
    const index = waiters.findIndex((waiter) => waiter.name === name);
    if (index >= 0) {
      waiters.splice(index, 1)[0].resolve(payload);
    }
  });
  main.wire_billing();
  await main.init_billing();
});

after(async () => {
  remove_tap();
  main.shutdown_billing();
  await fs.rm(root, { recursive: true, force: true });
});

test("wire_billing hands the SDK runtime to the Claude seam and init_billing reads no login while the Claude plan is off", () => {
  assert.deepEqual(main.claude_runtime().usage_limit_prefixes, ["stub usage limit"]);
  assert.equal(main.claude_account().status, "unknown");
  assert.deepEqual(main.process_calls.runs, []);
  assert.deepEqual(emitted, []);
});

test("turning the Claude plan on publishes the catalog with the Claude ids and reads the login in the background", async () => {
  const models = next_event<ModelCatalog>("models:changed");
  const account = next_event<ClaudeAccount>("claude:changed");
  await main.update_settings({ claude_billing: "claude" });
  assert.deepEqual((await models).claude_plan_ids, claude_ids);
  assert.equal((await account).status, "signed_out");
  assert.equal((await account).login_command, "& 'C:/stub/claude.exe' auth login --claudeai");
  assert.deepEqual(main.process_calls.runs, [["auth", "status", "--json"]]);
  assert.equal(main.claude_account().status, "signed_out");
});

test("an unrelated settings change publishes nothing and turning the Claude plan off publishes without reading the login", async () => {
  const models = next_event<ModelCatalog>("models:changed");
  await main.update_settings({ language: "de" });
  await main.update_settings({ claude_billing: "api" });
  assert.equal((await models).claude_plan_ids, undefined);
  assert.equal(published().length, 2);
  assert.equal(main.process_calls.runs.length, 1);
});

test("the ChatGPT billing switch still publishes on its own", async () => {
  const models = next_event<ModelCatalog>("models:changed");
  await main.update_settings({ billing: "chatgpt" });
  const catalog = await models;
  assert.ok((catalog.plan_ids ?? []).length > 0);
  assert.equal(catalog.claude_plan_ids, undefined);
  const back = next_event<ModelCatalog>("models:changed");
  await main.update_settings({ billing: "api" });
  assert.equal((await back).plan_ids, undefined);
  assert.equal(main.process_calls.runs.length, 1);
});

test("a refused login reported by the runtime reads the login again", async () => {
  const account = next_event<ClaudeAccount>("claude:changed");
  main.claude_runtime().auth_failed();
  assert.equal((await account).status, "signed_out");
  assert.equal(main.process_calls.runs.length, 2);
});

test("init_billing reads the login once at startup while the Claude plan is on, and shutdown kills the Claude children", async () => {
  const switched = next_event<ClaudeAccount>("claude:changed");
  await main.update_settings({ claude_billing: "claude" });
  await switched;
  const started = next_event<ClaudeAccount>("claude:changed");
  await main.init_billing();
  await started;
  assert.equal(main.process_calls.runs.length, 4);
  const kills = main.process_calls.kills;
  main.shutdown_billing();
  assert.equal(main.process_calls.kills, kills + 1);
});

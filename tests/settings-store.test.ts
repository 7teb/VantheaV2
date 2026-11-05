import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { SettingsView } from "../shared/settings.ts";
import { convert_legacy_settings } from "../electron/settings/legacy.ts";
import {
  add_project,
  get_secret,
  get_settings,
  init_settings,
  remove_project,
  set_secret,
  settings_view,
  update_project,
  update_settings,
} from "../electron/settings/store.ts";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";
import type { SecretCodec } from "../electron/storage/secrets.ts";

const fixture = path.join(import.meta.dirname, "fixtures", "legacy", "legacy-settings.json");

const fake_codec = (available = true): SecretCodec => ({
  available: () => available,
  encrypt: (plain) => {
    if (!available) {
      throw new Error("encryption unavailable");
    }
    return Buffer.from(`enc:${plain}`).toString("base64");
  },
  decrypt: (cipher) => {
    const text = Buffer.from(cipher, "base64").toString("utf8");
    if (!text.startsWith("enc:")) {
      throw new Error("not encrypted by this codec");
    }
    return text.slice(4);
  },
});

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-settings-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const files_in = async (name: string) => {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, "v2"), { recursive: true });
  return { settings: path.join(dir, "v2", "settings.json"), secrets: path.join(dir, "v2", "secrets.json"), legacy_settings: path.join(dir, "settings.json") };
};

test("normalize_settings validates enums, clamps numbers and drops invalid entries", () => {
  const settings = normalize_settings(
    {
      language: "fr",
      model: "nvidia:deepseek-ai/deepseek-v4-flash",
      effort: "HIGH!",
      mode: "goal",
      personality: "friendly",
      custom_instructions: "x".repeat(60000),
      web_search: { enabled: "yes", max_results: 99, depth: "deep", topic: "news" },
      image_gen: { quality: "ultra" },
      projects: [{ path: "D:\\a", name: "" }, { path: "d:/a/" }, { path: "" }, "nope"],
      mcp_servers: { ok: { command: "uvx", args: ["x", 3], env: { A: "1", B: 2 } }, "bad name": { command: "x" }, empty: { command: "" } },
      mcp_tools: { "ok/tool": { risk: "dangerous", enabled: false }, "ok/other": { risk: "wild" }, broken: {} },
    },
    default_settings(),
  );
  assert.equal(settings.language, "en");
  assert.equal(settings.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(settings.effort, "high");
  assert.equal(settings.mode, "auto");
  assert.equal(settings.personality, "friendly");
  assert.equal(settings.custom_instructions.length, 60000);
  assert.deepEqual(settings.web_search, { enabled: false, max_results: 20, topic: "news" });
  assert.equal(settings.image_gen.quality, "auto");
  assert.deepEqual(settings.projects, [{ path: "D:\\a", name: "a", pinned: false, folder_id: "" }]);
  assert.deepEqual(settings.mcp_servers, { ok: { command: "uvx", args: ["x"], cwd: "", env: { A: "1" }, enabled: true } });
  assert.deepEqual(settings.mcp_tools, { "ok/tool": { risk: "dangerous", enabled: false }, "ok/other": { risk: null, enabled: true } });
});

test("model context settings keep a limit or null, clamp both values and drop bad model ids", () => {
  const settings = normalize_settings(
    {
      model_context: {
        "openai/gpt-6.1-sol": { limit: 272000, compact_percent: 60 },
        "a/tiny": { limit: 500, compact_percent: 12 },
        "a/max": { limit: null, compact_percent: 99 },
        "a/broken": "x",
        "": { limit: 1000 },
      },
    },
    default_settings(),
  );
  assert.deepEqual(settings.model_context, {
    "openai/gpt-6.1-sol": { limit: 272000, compact_percent: 60 },
    "a/tiny": { limit: 16000, compact_percent: 50 },
    "a/max": { limit: null, compact_percent: 95 },
    "a/broken": { limit: null, compact_percent: 70 },
  });
  assert.deepEqual(default_settings().model_context, {});
});

test("merge_settings merges struct fields, replaces maps and keeps current values for invalid input", () => {
  const current = { ...default_settings(), mcp_servers: { a: { command: "x", args: [], cwd: "", env: {}, enabled: true } } };
  const next = merge_settings(current, { web_search: { enabled: true }, mode: "bogus", mcp_servers: {}, unknown: 1 });
  assert.deepEqual(next.web_search, { ...current.web_search, enabled: true });
  assert.equal(next.mode, "auto");
  assert.deepEqual(next.mcp_servers, {});
});

test("convert_legacy_settings maps camelCase fields and drops removed features", async () => {
  const legacy = convert_legacy_settings(JSON.parse(await fs.readFile(fixture, "utf8")));
  const settings = legacy.settings;
  assert.equal(settings.language, "de");
  assert.equal(settings.model, "anthropic/claude-opus-5");
  assert.equal(settings.effort, "xhigh");
  assert.equal(settings.mode, "ask");
  assert.equal(settings.personality, "cynical");
  assert.equal(settings.custom_instructions, "Answer in German. Keep it short.");
  assert.deepEqual(settings.memory, { enabled: true, exclude_tool_chats: true });
  assert.deepEqual(settings.web_search, { enabled: true, max_results: 20, topic: "news" });
  assert.deepEqual(settings.image_gen, { enabled: true, model: "openai/gpt-image-2", quality: "high" });
  assert.deepEqual(settings.skills, { disabled: ["frontend-design", "pdf"] });
  assert.deepEqual(settings.projects, [
    { path: "D:\\Projects\\native-tools", name: "native-tools", pinned: false, folder_id: "" },
    { path: "D:\\Projects\\vanthea", name: "Vanthea Web", pinned: true, folder_id: "" },
    { path: "C:\\Users\\dev\\scratch", name: "scratch", pinned: true, folder_id: "" },
  ]);
  assert.deepEqual(Object.keys(settings.mcp_servers), ["ida-pro", "blender"]);
  assert.deepEqual(settings.mcp_servers["ida-pro"], {
    command: "uvx",
    args: ["ida-pro-mcp"],
    cwd: "",
    env: { IDA_PATH: "C:\\Program Files\\IDA Pro 9.1" },
    enabled: true,
  });
  assert.equal(settings.mcp_servers.blender?.enabled, false);
  assert.deepEqual(settings.mcp_tools, {
    "ida-pro/patch_address_assembles": { risk: "dangerous", enabled: false },
    "ida-pro/decompile_function": { risk: "readonly", enabled: true },
  });
  assert.equal(legacy.secrets.openrouter, "djEwAAAAOeXmP2u1q3l8YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=");
  assert.equal(legacy.secrets.tavily, "djEwAAAAk7mQ9kq2dGF2aWx5LWZpeHR1cmUta2V5LWNpcGhlcnRleHQ=");
  for (const removed of ["nvidia", "nvidiaKey", "theme", "narrator", "videoGen", "projectMeta"]) {
    assert.equal(Object.hasOwn(settings, removed), false);
  }
});

test("init_settings imports legacy settings once and moves ciphertext as-is", async () => {
  const files = await files_in("legacy");
  await fs.copyFile(fixture, files.legacy_settings);
  const views: SettingsView[] = [];
  await init_settings({ files, codec: fake_codec(), on_change: (view) => views.push(view) });
  assert.equal(get_settings().language, "de");
  const secrets = JSON.parse(await fs.readFile(files.secrets, "utf8"));
  assert.equal(secrets.openrouter, "djEwAAAAOeXmP2u1q3l8YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=");
  assert.equal(get_secret("openrouter"), "");
  assert.equal(settings_view().secrets.openrouter, false);
  const stored = JSON.parse(await fs.readFile(files.settings, "utf8"));
  assert.equal(stored.language, "de");
  await fs.writeFile(files.legacy_settings, JSON.stringify({ language: "en" }));
  await init_settings({ files, codec: fake_codec(), on_change: () => undefined });
  assert.equal(get_settings().language, "de");
});

test("settings file with a BOM loads, and a missing legacy file yields defaults", async () => {
  const files = await files_in("bom");
  await fs.writeFile(files.settings, `\ufeff${JSON.stringify({ language: "de", mode: "full" })}`, "utf8");
  await init_settings({ files, codec: fake_codec(), on_change: () => undefined });
  assert.equal(get_settings().language, "de");
  assert.equal(get_settings().mode, "full");
  const fresh = await files_in("fresh");
  await init_settings({ files: fresh, codec: fake_codec(), on_change: () => undefined });
  assert.deepEqual(get_settings(), default_settings());
});

test("secrets are encrypted through the codec and refused when encryption is unavailable", async () => {
  const files = await files_in("secrets");
  const views: SettingsView[] = [];
  await init_settings({ files, codec: fake_codec(), on_change: (view) => views.push(view) });
  const view = await set_secret("openrouter", "  sk-or-test  ");
  assert.equal(view.secrets.openrouter, true);
  assert.equal(get_secret("openrouter"), "sk-or-test");
  const stored = JSON.parse(await fs.readFile(files.secrets, "utf8"));
  assert.equal(Buffer.from(stored.openrouter, "base64").toString("utf8"), "enc:sk-or-test");
  assert.equal(views.at(-1)?.secrets.openrouter, true);
  await init_settings({ files, codec: fake_codec(false), on_change: () => undefined });
  await assert.rejects(set_secret("tavily", "tvly-x"), /unavailable/);
  assert.equal(JSON.parse(await fs.readFile(files.secrets, "utf8")).tavily, null);
});

test("update_settings emits once per real change and projects are managed through it", async () => {
  const files = await files_in("projects");
  const views: SettingsView[] = [];
  await init_settings({ files, codec: fake_codec(), on_change: (view) => views.push(view) });
  await update_settings({ language: "en" });
  assert.equal(views.length, 0);
  await update_settings({ language: "de" });
  assert.equal(views.length, 1);
  const first = await add_project("D:\\Work\\alpha", "1:10");
  await add_project("D:\\Work\\beta", "1:20");
  const again = await add_project("d:/work/alpha/", "1:10");
  assert.deepEqual(again, first);
  assert.deepEqual(get_settings().projects.map((entry) => entry.path), ["D:\\Work\\alpha", "D:\\Work\\beta"]);
  await update_project("D:\\Work\\beta", { name: "Beta", pinned: true });
  assert.deepEqual(get_settings().projects[1], { path: "D:\\Work\\beta", name: "Beta", pinned: true, folder_id: "1:20" });
  await update_project("D:\\Work\\beta", { name: "  " });
  assert.equal(get_settings().projects[1]?.name, "beta");
  await remove_project("D:\\WORK\\ALPHA");
  assert.deepEqual(get_settings().projects.map((entry) => entry.path), ["D:\\Work\\beta"]);
  await assert.rejects(update_project("D:\\nowhere", { pinned: true }), /not in the project list/);
  const stored = JSON.parse(await fs.readFile(files.settings, "utf8"));
  assert.equal(stored.projects.length, 1);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import type { Message } from "../shared/chat.ts";
import { chat_choice, type ModelCatalog, type ModelEntry } from "../shared/models.ts";
import type { SettingsView } from "../shared/settings.ts";
import { plan_source, set_plan_source, type PlanSource } from "../electron/model/plan/source.ts";
import { get_internal_secret, get_settings, init_settings, on_settings_changed, set_internal_secret, set_secret, update_settings } from "../electron/settings/store.ts";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";
import type { SecretCodec } from "../electron/storage/secrets.ts";

const codec: SecretCodec = {
  available: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`).toString("base64"),
  decrypt: (cipher) => Buffer.from(cipher, "base64").toString("utf8").slice(4),
};

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-chatgpt-billing-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const files_in = async (name: string) => {
  const dir = path.join(root, name, "v2");
  await fs.mkdir(dir, { recursive: true });
  return { settings: path.join(dir, "settings.json"), secrets: path.join(dir, "secrets.json"), legacy_settings: path.join(root, name, "settings.json") };
};

test("billing defaults to API pricing and a settings file without the keys loads as API pricing", async () => {
  assert.equal(default_settings().billing, "api");
  assert.equal(default_settings().inactive_billing_model, "");
  const loaded = normalize_settings({ language: "de", model: "openai/gpt-6.1-sol" }, default_settings());
  assert.equal(loaded.billing, "api");
  assert.equal(loaded.inactive_billing_model, "");
  assert.equal(normalize_settings({ billing: "plus", inactive_billing_model: 7 }, default_settings()).billing, "api");
  assert.equal(normalize_settings({ billing: "chatgpt", inactive_billing_model: "a/b" }, default_settings()).inactive_billing_model, "a/b");
  const files = await files_in("without-keys");
  await fs.writeFile(files.settings, JSON.stringify({ language: "de", model: "openai/gpt-6.1-sol" }));
  await init_settings({ files, codec, on_change: () => undefined });
  assert.equal(get_settings().billing, "api");
  assert.equal(get_settings().inactive_billing_model, "");
  assert.equal(get_settings().model, "openai/gpt-6.1-sol");
});

test("switching billing swaps the default model with the remembered one of the other mode", () => {
  const api = { ...default_settings(), model: "deepseek/deepseek-v4.1-flash-1017" };
  const plan = merge_settings(api, { billing: "chatgpt" });
  assert.equal(plan.billing, "chatgpt");
  assert.equal(plan.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(plan.inactive_billing_model, "deepseek/deepseek-v4.1-flash-1017");
  const picked = merge_settings(plan, { model: "openai/gpt-6-luna" });
  assert.equal(picked.model, "openai/gpt-6-luna");
  assert.equal(picked.inactive_billing_model, "deepseek/deepseek-v4.1-flash-1017");
  const back = merge_settings(picked, { billing: "api" });
  assert.equal(back.billing, "api");
  assert.equal(back.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.equal(back.inactive_billing_model, "openai/gpt-6-luna");
  const again = merge_settings(back, { billing: "chatgpt" });
  assert.equal(again.model, "openai/gpt-6-luna");
  assert.equal(again.inactive_billing_model, "deepseek/deepseek-v4.1-flash-1017");
  assert.deepEqual(merge_settings(again, { billing: "chatgpt" }), again);
  assert.deepEqual(merge_settings(again, { billing: "plus" }), again);
});

test("a patch that carries a model together with billing keeps the patch's model", () => {
  const api = { ...default_settings(), model: "deepseek/deepseek-v4.1-flash-1017", inactive_billing_model: "openai/gpt-6.1-sol" };
  const next = merge_settings(api, { billing: "chatgpt", model: "openai/gpt-6-luna" });
  assert.equal(next.billing, "chatgpt");
  assert.equal(next.model, "openai/gpt-6-luna");
  assert.equal(next.inactive_billing_model, "deepseek/deepseek-v4.1-flash-1017");
});

const entry = (id: string): ModelEntry => ({
  id,
  label: id,
  provider: "OpenAI",
  provider_order: ["openai"],
  efforts: ["low", "high", "major"],
  default_effort: "high",
  vision: true,
  context_length: 1000,
  max_output: 100,
  reasoning_passback: false,
});

const plan_catalog: ModelCatalog = {
  models: [entry("openai/gpt-6-luna")],
  side: { title: "s/t", overseer: "s/o", vision: "s/v", reasoning_status: "s/r", transcription: "s/x", git_text: "s/g" },
  side_models: [],
  image_models: [],
  plan_ids: ["openai/gpt-6-luna"],
};

const assistant = (model: string, effort: string) => ({ id: `a-${model}`, role: "assistant", model, effort, steps: [] }) as unknown as Message;

test("chat_choice returns a stored choice whatever the catalog lists", () => {
  const stored = { model: "anthropic/claude-opus-5.5", effort: "max", pro: false };
  const fallback = { model: "openai/gpt-6-luna", effort: "high", pro: false };
  assert.equal(chat_choice(stored, undefined, plan_catalog, fallback), stored);
  assert.equal(chat_choice(stored, [assistant("openai/gpt-6-luna", "low")], plan_catalog, fallback), stored);
  assert.equal(chat_choice(stored, undefined, null, fallback), stored);
  const listed = { model: "openai/gpt-6-luna", effort: "low", pro: false };
  assert.equal(chat_choice(listed, undefined, plan_catalog, fallback), listed);
  assert.deepEqual(chat_choice(undefined, [assistant("openai/gpt-6-luna", "low")], plan_catalog, fallback), listed);
});

test("the default plan source reports API pricing and refuses tokens", async () => {
  const source = plan_source();
  assert.equal(source.billing(), "api");
  await assert.rejects(source.access_token(), /ChatGPT plan source is not wired/);
  await assert.rejects(source.renewed_token("stale"), /ChatGPT plan source is not wired/);
  assert.equal(source.model_rejected("openai/gpt-6-luna"), undefined);
  assert.equal(source.account_models(), null);
  const wired: PlanSource = { ...source, billing: () => "chatgpt" };
  set_plan_source(wired);
  assert.equal(plan_source().billing(), "chatgpt");
  set_plan_source(source);
  assert.equal(plan_source().billing(), "api");
});

test("on_settings_changed fires after update_settings and set_secret, survives a failing listener and can be removed", async () => {
  const files = await files_in("listeners");
  const primary: SettingsView[] = [];
  await init_settings({ files, codec, on_change: (view) => primary.push(view) });
  const seen: string[] = [];
  const failing = mock.fn(() => {
    throw new Error("listener broke");
  });
  const logged = mock.method(console, "error", () => undefined);
  const stop_failing = on_settings_changed(failing);
  const stop = on_settings_changed((view) => seen.push(`${view.billing}:${primary.length}`));
  try {
    await update_settings({ billing: "chatgpt" });
    assert.deepEqual(seen, ["chatgpt:1"]);
    assert.equal(failing.mock.callCount(), 1);
    assert.equal(logged.mock.callCount(), 1);
    assert.match(String(logged.mock.calls[0]?.arguments[0]), /\[settings\] a settings change listener failed:/);
    await update_settings({ billing: "chatgpt" });
    assert.equal(seen.length, 1);
    await set_secret("openrouter", "sk-or-test");
    assert.deepEqual(seen, ["chatgpt:1", "chatgpt:2"]);
    stop();
    stop_failing();
    await update_settings({ billing: "api" });
    assert.equal(seen.length, 2);
    assert.equal(failing.mock.callCount(), 2);
    assert.equal(primary.length, 3);
  } finally {
    stop();
    stop_failing();
    logged.mock.restore();
  }
  const stored = JSON.parse(await fs.readFile(files.settings, "utf8"));
  assert.equal(stored.billing, "api");
});

test("the ChatGPT session is an internal secret stored encrypted next to the other keys", async () => {
  const files = await files_in("session");
  await init_settings({ files, codec, on_change: () => undefined });
  assert.equal(get_internal_secret("chatgpt_session"), "");
  await set_internal_secret("chatgpt_session", JSON.stringify({ account: null, pending_client_id: null }));
  const stored = JSON.parse(await fs.readFile(files.secrets, "utf8"));
  assert.equal(Buffer.from(stored.chatgpt_session, "base64").toString("utf8"), 'enc:{"account":null,"pending_client_id":null}');
  await init_settings({ files, codec, on_change: () => undefined });
  assert.equal(get_internal_secret("chatgpt_session"), '{"account":null,"pending_client_id":null}');
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(files.settings, "utf8")), "chatgpt_session"), false);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { chatgpt_usage_url, type ChatgptAccount } from "../shared/chatgpt.ts";
import type { ModelCatalog, ModelEntry } from "../shared/models.ts";
import type { BillingMode, SettingsView } from "../shared/settings.ts";
import { billing as de_billing } from "../src/i18n/de/billing.ts";
import { billing as en_billing } from "../src/i18n/en/billing.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";

const entry = (id: string, label: string): ModelEntry => ({
  id,
  label,
  provider: "openai",
  provider_order: ["openai"],
  efforts: ["low", "high"],
  default_effort: "low",
  vision: true,
  context_length: 400_000,
  max_output: 128_000,
  reasoning_passback: true,
});

const side = { title: "s", overseer: "s", vision: "s", reasoning_status: "s", transcription: "s", git_text: "s" };

const api_catalog: ModelCatalog = {
  models: [entry("deepseek/deepseek-v4.1-flash-1017", "DeepSeek"), entry("openai/gpt-6.2-sol", "GPT-6.2 Sol")],
  side,
  side_models: [],
  image_models: [],
};

const plan_catalog: ModelCatalog = {
  models: [
    entry("deepseek/deepseek-v4.1-flash-1017", "DeepSeek"),
    { ...entry("openai/gpt-6.2-sol", "GPT-6.2 Sol"), pro: { id: "openai/gpt-6.2-sol-pro", label: "GPT-6.2 Sol Pro" } },
    { ...entry("openai/gpt-6-luna", "GPT-6 Luna"), pro: { id: "openai/gpt-6-luna-pro", label: "GPT-6 Luna Pro" } },
  ],
  side,
  side_models: [],
  image_models: [],
  plan_ids: ["openai/gpt-6.2-sol", "openai/gpt-6.2-sol-pro"],
};

const view = (billing: BillingMode, model: string): SettingsView => ({
  language: "en",
  model,
  effort: "low",
  mode: "ask",
  projects: [],
  personality: "pragmatic",
  custom_instructions: "",
  notification_sound: true,
  accent_color: "",
  memory: { enabled: true },
  web_search: { enabled: false, max_results: 5, topic: "general" },
  image_gen: { enabled: false, model: "i", quality: "auto" },
  mcp_servers: {},
  mcp_tools: {},
  skills: { disabled: [] },
  model_context: {},
  hooks: { global: [], projects: {} },
  billing,
  inactive_billing_model: "",
  secrets: { openrouter: false, tavily: false },
});

const account = (patch: Partial<ChatgptAccount> = {}): ChatgptAccount => ({
  status: "signed_out",
  email: null,
  name: null,
  plan_enabled: false,
  notice_seen: false,
  error: null,
  ...patch,
});

const calls: { name: string; args: unknown[] }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
let answer: ChatgptAccount = account();
let current: SettingsView = view("api", "deepseek/deepseek-v4.1-flash-1017");

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name.startsWith("chatgpt:")) return answer;
    if (name === "models:catalog") return api_catalog;
    if (name === "settings:update") current = { ...current, ...(args[0] as Partial<SettingsView>) };
    if (name === "settings:get" || name === "settings:update") return current;
    return undefined;
  },
  on: (name, listener) => {
    listeners.set(name, listener);
    return () => {
      listeners.delete(name);
    };
  },
  send: () => {},
};

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const render = (component: string, props: Record<string, unknown> = {}) => client.flushSync(() => root.render(client.createElement(client[component], props)));

const button = (label: string): FakeElement => {
  const found = container.matching((element) => element.tagName === "BUTTON" && element.textContent === label);
  assert.equal(found.length, 1, `one button labelled ${label}`);
  return found[0];
};

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const invoked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { resolve_choice } from "./src/state/model-choice.ts";',
      'export { init_models, models_store } from "./src/state/models.ts";',
      'export { choice_view, model_menu_sections, runs_on_plan } from "./src/features/composer/model-menu.ts";',
      'export { settings_store } from "./src/state/settings.ts";',
      'export { chatgpt_store, init_chatgpt } from "./src/state/chatgpt.ts";',
      'export { ChatgptRow } from "./src/features/settings/panes/ChatgptRow.tsx";',
      'export { ErrorCard } from "./src/features/chat/TurnStatus.tsx";',
    ],
    [stub_components("none", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  client.flushSync(() => root.unmount());
  restore();
});

beforeEach(() => {
  calls.length = 0;
});

test("resolve_choice in API billing behaves as before", () => {
  const settings = { model: "deepseek/unlisted", effort: "low", billing: "api" };
  const stored = { model: "deepseek/stored", effort: "high", pro: false };
  assert.deepEqual(client.resolve_choice("c1", stored, undefined, api_catalog, settings, false, null), stored);
  assert.deepEqual(client.resolve_choice(null, undefined, undefined, api_catalog, settings, false, null), { model: "deepseek/unlisted", effort: "low", pro: false });
  assert.deepEqual(client.resolve_choice("c1", undefined, undefined, api_catalog, settings, false, null), { model: "deepseek/unlisted", effort: "low", pro: false });
});

test("in plan billing a stored choice and a settings.model off the plan stay, the same as in API billing", () => {
  const settings = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "low", billing: "chatgpt" };
  const stored = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "high", pro: false };
  const fresh = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "low", pro: false };
  for (const catalog of [api_catalog, plan_catalog]) {
    assert.deepEqual(client.resolve_choice("c1", stored, undefined, catalog, settings, false, null), stored);
    assert.deepEqual(client.resolve_choice(null, undefined, undefined, catalog, settings, false, null), fresh);
    assert.deepEqual(client.resolve_choice("c1", undefined, undefined, catalog, settings, false, null), fresh);
  }
  const listed = { model: "openai/gpt-6.2-sol", effort: "high", pro: false };
  assert.deepEqual(client.resolve_choice("c1", listed, undefined, plan_catalog, settings, false, null), listed);
});

test("the picker lists every catalog model in plan billing", () => {
  const choice = { model: "deepseek/deepseek-v4.1-flash-1017", effort: "low", pro: false };
  const [models] = client.model_menu_sections((key: string) => key, plan_catalog, choice, () => {});
  assert.deepEqual(
    models.items.map((item: { id: string }) => item.id),
    plan_catalog.models.map((model) => model.id),
  );
});

test("runs_on_plan is true only for a model whose id the plan serves", () => {
  const menu_model = (catalog: ModelCatalog, model: string, pro = false) => client.choice_view(catalog, { model, effort: "low", pro }).model;
  assert.equal(client.runs_on_plan(plan_catalog, menu_model(plan_catalog, "openai/gpt-6.2-sol")), true);
  assert.equal(client.runs_on_plan(plan_catalog, menu_model(plan_catalog, "deepseek/deepseek-v4.1-flash-1017")), false);
  assert.equal(client.runs_on_plan(plan_catalog, menu_model(plan_catalog, "openai/gpt-6-luna")), false);
  assert.equal(client.runs_on_plan(plan_catalog, menu_model(plan_catalog, "openai/gpt-6.2-sol", true)), true);
  assert.equal(client.runs_on_plan(plan_catalog, menu_model(plan_catalog, "openai/gpt-6-luna", true)), false);
  const base_only = { ...plan_catalog, plan_ids: ["openai/gpt-6.2-sol"] };
  assert.equal(client.runs_on_plan(base_only, menu_model(base_only, "openai/gpt-6.2-sol", true)), false);
  assert.equal(client.runs_on_plan(api_catalog, menu_model(api_catalog, "openai/gpt-6.2-sol")), false);
  assert.equal(client.runs_on_plan(plan_catalog, null), false);
});

test("the picker keeps the speed tier of a variant off the plan and drops it for a variant on the plan", () => {
  const sol_fast = { fast: { provider_order: ["openai/fast"] } };
  const tiered: ModelCatalog = { ...plan_catalog, models: plan_catalog.models.map((model) => (model.id === "openai/gpt-6.2-sol" ? { ...model, tiers: sol_fast } : model)), plan_ids: ["openai/gpt-6.2-sol"] };
  const pro_fast = client.choice_view(tiered, { model: "openai/gpt-6.2-sol", effort: "low", pro: true, tier: "fast" }).model;
  assert.deepEqual([pro_fast.id, pro_fast.label, pro_fast.provider_order, pro_fast.tiers], ["openai/gpt-6.2-sol-pro", "GPT-6.2 Sol Pro Fast", ["openai/fast"], sol_fast]);
  assert.equal(client.runs_on_plan(tiered, pro_fast), false);
  const base_fast = client.choice_view(tiered, { model: "openai/gpt-6.2-sol", effort: "low", pro: false, tier: "fast" }).model;
  assert.deepEqual([base_fast.id, base_fast.label, base_fast.provider_order, base_fast.tiers], ["openai/gpt-6.2-sol", "GPT-6.2 Sol", ["openai"], undefined]);
  assert.equal(client.runs_on_plan(tiered, base_fast), true);
});

test("plan billing keeps a DeepSeek default and still replaces an id the catalog does not have", async () => {
  const stop = client.init_models();
  await settled();
  current = view("chatgpt", "deepseek/deepseek-v4.1-flash-1017");
  client.settings_store.set(current);
  client.models_store.set({ status: "ready", catalog: api_catalog });
  await settled();
  assert.deepEqual(invoked("settings:update"), []);
  listeners.get("models:changed")?.(plan_catalog);
  await settled();
  assert.equal(client.models_store.get().catalog, plan_catalog);
  assert.deepEqual(invoked("settings:update"), []);
  current = view("chatgpt", "openai/gpt-5");
  client.settings_store.set(current);
  await settled();
  assert.deepEqual(invoked("settings:update"), [[{ model: "deepseek/deepseek-v4.1-flash-1017", effort: "low" }]]);
  stop();
});

test("the chatgpt store loads the status and follows changes", async () => {
  answer = account({ status: "expired", email: "me@example.com" });
  const stop = client.init_chatgpt();
  await settled();
  assert.deepEqual(client.chatgpt_store.get(), answer);
  const changed = account({ status: "signed_in", email: "me@example.com", plan_enabled: true });
  listeners.get("chatgpt:changed")?.(changed);
  assert.deepEqual(client.chatgpt_store.get(), changed);
  stop();
});

test("the account row offers Continue with ChatGPT when no account is remembered", async () => {
  client.chatgpt_store.set(null);
  render("ChatgptRow");
  assert.equal(container.textContent, "");
  answer = account({ status: "signing_in" });
  client.chatgpt_store.set(account());
  render("ChatgptRow");
  assert.match(container.textContent, /Use your ChatGPT plan/);
  assert.match(container.textContent, /usage included in your ChatGPT plan or credits balance/);
  const marks = button("Continue with ChatGPT").matching((element) => element.tagName === "svg");
  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.getAttribute("viewBox"), "769.694 228.635 267.196 264.812");
  press(button("Continue with ChatGPT"));
  await settled();
  assert.deepEqual(invoked("chatgpt:sign_in"), [[{ fresh: true, consent: false }]]);
  assert.equal(client.chatgpt_store.get().status, "signing_in");
  assert.match(container.textContent, /Opening ChatGPT\.\.\./);
  answer = account();
  press(button("Cancel"));
  await settled();
  assert.equal(invoked("chatgpt:cancel_sign_in").length, 1);
});

test("a remembered account continues with its client or starts a fresh registration", async () => {
  answer = account({ status: "signed_out", email: "me@example.com" });
  client.chatgpt_store.set(answer);
  render("ChatgptRow");
  assert.match(container.textContent, /me@example\.com/);
  press(button("Continue with ChatGPT"));
  press(button("Use another account"));
  await settled();
  assert.deepEqual(invoked("chatgpt:sign_in"), [[{ fresh: false, consent: false }], [{ fresh: true, consent: false }]]);
});

test("a signed-in account shows Connected, Manage usage and Sign out", async () => {
  answer = account({ status: "signed_in", email: "me@example.com", name: "Me", plan_enabled: true });
  client.chatgpt_store.set(answer);
  render("ChatgptRow");
  assert.match(container.textContent, /Me/);
  assert.match(container.textContent, /Connected/);
  press(button("Manage usage"));
  answer = account({ email: "me@example.com" });
  press(button("Sign out"));
  await settled();
  assert.deepEqual(invoked("shell:open_external"), [[chatgpt_usage_url]]);
  assert.equal(invoked("chatgpt:sign_out").length, 1);
});

test("a sign-in without plan permission offers Enable plan usage", async () => {
  answer = account({ status: "signed_in", email: "me@example.com", plan_enabled: false });
  client.chatgpt_store.set(answer);
  render("ChatgptRow");
  assert.match(container.textContent, /Plan usage is not enabled for this sign-in/);
  press(button("Enable plan usage"));
  await settled();
  assert.deepEqual(invoked("chatgpt:sign_in"), [[{ fresh: false, consent: true }]]);
});

test("an expired sign-in offers Reconnect and shows the last error", async () => {
  answer = account({ status: "expired", email: "me@example.com", error: { code: "wrong_account", detail: "me@example.com" } });
  client.chatgpt_store.set(answer);
  render("ChatgptRow");
  assert.match(container.textContent, /You signed in with a different account than me@example\.com\./);
  press(button("Reconnect to ChatGPT"));
  await settled();
  assert.deepEqual(invoked("chatgpt:sign_in"), [[{ fresh: false, consent: false }]]);
});

test("a plan limit error shows the account and Manage usage without a reset time", () => {
  client.chatgpt_store.set(account({ status: "signed_in", email: "me@example.com", plan_enabled: true }));
  render("ErrorCard", { error: { kind: "plan_limit", message: "ChatGPT plan 429: limit" } });
  assert.match(container.textContent, /ChatGPT plan usage limit reached/);
  assert.match(container.textContent, /me@example\.com/);
  assert.doesNotMatch(container.textContent, /reset/i);
  press(button("Manage usage"));
  assert.deepEqual(invoked("shell:open_external"), [[chatgpt_usage_url]]);
  render("ErrorCard", { error: { kind: "plan_auth", message: "" } });
  assert.match(container.textContent, /The ChatGPT sign-in is missing or has expired\./);
  assert.equal(button("Open settings").tagName, "BUTTON");
  render("ErrorCard", { error: { kind: "plan_model", message: "" } });
  assert.equal(container.matching((element) => element.tagName === "BUTTON").length, 0);
});

test("both languages have the same billing keys and keep the sign-in label in English", () => {
  assert.deepEqual(Object.keys(de_billing).sort(), Object.keys(en_billing).sort());
  assert.equal(de_billing["billing.continue"], en_billing["billing.continue"]);
  assert.equal(de_billing["billing.mode_plan"], "ChatGPT-Abo");
});

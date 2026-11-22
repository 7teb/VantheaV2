import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Plugin } from "esbuild";
import type { ClaudeAccount } from "../shared/claude.ts";
import type { ModelCatalog, ModelEntry } from "../shared/models.ts";
import type { BillingMode, ClaudeBillingMode, SettingsView } from "../shared/settings.ts";
import type { ModelPrice } from "../shared/tool-view.ts";
import { billing as de_billing } from "../src/i18n/de/billing.ts";
import { tools as de_tools } from "../src/i18n/de/tools.ts";
import { billing as en_billing } from "../src/i18n/en/billing.ts";
import { tools as en_tools } from "../src/i18n/en/tools.ts";
import { bundle, install_dom, stub_components, type FakeElement, type Vx } from "./dom-kit.ts";

const entry = (id: string, label: string, provider: string): ModelEntry => ({
  id,
  label,
  provider,
  provider_order: [provider],
  efforts: ["high"],
  default_effort: "high",
  vision: true,
  context_length: 400_000,
  max_output: 128_000,
  reasoning_passback: true,
});

const side = { title: "s", overseer: "s", vision: "s", reasoning_status: "s", transcription: "s", git_text: "s" };

const deepseek = "deepseek/deepseek-v4.1-flash-1017";
const sol = "openai/gpt-6.2-sol";
const opus = "anthropic/claude-opus-5.5";

const catalog: ModelCatalog = {
  models: [entry(deepseek, "DeepSeek", "deepseek"), entry(sol, "GPT-6.2 Sol", "openai"), { ...entry(opus, "Claude Opus 5.5", "anthropic"), claude_code: "claude-opus-5-5" }],
  side,
  side_models: [],
  image_models: [],
  plan_ids: [sol],
  claude_plan_ids: [opus],
};

const view = (billing: BillingMode, claude_billing: ClaudeBillingMode): SettingsView => ({
  language: "en",
  model: deepseek,
  effort: "high",
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
  claude_billing,
  secrets: { openrouter: true, tavily: false },
});

const login_command = "& 'C:\\Program Files\\VantheaX\\claude.exe' auth login --claudeai";

const account = (patch: Partial<ClaudeAccount> = {}): ClaudeAccount => ({
  status: "signed_out",
  email: null,
  subscription: null,
  auth_method: null,
  login_command,
  detail: "",
  ...patch,
});

const calls: { name: string; args: unknown[] }[] = [];
const sent: unknown[][] = [];
const listeners = new Map<string, (payload: unknown) => void>();
let answer: ClaudeAccount = account();
let current: SettingsView = view("api", "api");

const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name.startsWith("claude:")) return answer;
    if (name === "terminal:create") return "pty-claude";
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
  send: (...args: unknown[]) => {
    sent.push(args);
  },
};

const row_stub = (name: string) =>
  `import { createElement } from "react"; export const ${name} = (props) => createElement("div", { "data-stub": "${name}" }, props.hint ?? "");`;

const floating_stub: Plugin = {
  name: "stub-floating",
  setup(builder) {
    builder.onResolve({ filter: /Floating.tsx$/ }, (args) => (path.basename(args.importer) === "ModelMenu.tsx" ? { path: "Floating", namespace: "floating-stub" } : undefined));
    builder.onLoad({ filter: /.*/, namespace: "floating-stub" }, () => ({
      contents: `import { createElement } from "react"; export const Floating = (props) => createElement("div", { className: props.className }, props.children);`,
      loader: "js",
      resolveDir: process.cwd(),
    }));
  },
};

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const settled = async () => {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const render = (component: string, props: Record<string, unknown> = {}) => client.flushSync(() => root.render(client.createElement(client[component], props)));

const fresh = (component: string, props: Record<string, unknown> = {}) => {
  client.flushSync(() => root.render(null));
  render(component, props);
};

const buttons = (label: string): FakeElement[] => container.matching((element) => element.tagName === "BUTTON" && element.textContent === label);

const button = (label: string): FakeElement => {
  const found = buttons(label);
  assert.equal(found.length, 1, `one button labelled ${label}`);
  return found[0];
};

const button_labels = () => container.matching((element) => element.tagName === "BUTTON").map((element) => element.textContent);

const press = (element: FakeElement) => {
  const props_key = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  assert.ok(props_key);
  client.flushSync(() => (element as unknown as Record<string, { onClick: () => void }>)[props_key].onClick());
};

const invoked = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);

const show_row = async (patch: Partial<ClaudeAccount>) => {
  answer = account(patch);
  client.claude_store.set(answer);
  fresh("ClaudeRow");
  await settled();
};

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { claude_store, init_claude, refresh_claude } from "./src/state/claude.ts";',
      'export { chatgpt_store } from "./src/state/chatgpt.ts";',
      'export { settings_store } from "./src/state/settings.ts";',
      'export { start_terminal, terminal_store } from "./src/state/terminal.ts";',
      'export { ui_store } from "./src/state/ui.ts";',
      'export { runs_on_claude_plan, runs_on_plan, choice_view } from "./src/features/composer/model-menu.ts";',
      'export { ModelMenu } from "./src/features/composer/ModelMenu.tsx";',
      'export { ClaudeRow } from "./src/features/settings/panes/ClaudeRow.tsx";',
      'export { GeneralPane } from "./src/features/settings/GeneralPane.tsx";',
      'export { ModelsBody } from "./src/features/tools/bodies-models.tsx";',
    ],
    [floating_stub, stub_components("GeneralPane.tsx", { ChatgptRow: row_stub("ChatgptRow"), SecretRow: row_stub("SecretRow"), BalanceLine: row_stub("BalanceLine"), AccentRow: row_stub("AccentRow") })],
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
  sent.length = 0;
});

test("the claude store loads the status and follows changes", async () => {
  answer = account({ status: "signed_in", email: "me@example.com", subscription: "max", auth_method: "claude.ai" });
  const stop = client.init_claude();
  await settled();
  assert.deepEqual(invoked("claude:status"), [[]]);
  assert.deepEqual(client.claude_store.get(), answer);
  const changed = account({ status: "signed_out" });
  listeners.get("claude:changed")?.(changed);
  assert.deepEqual(client.claude_store.get(), changed);
  stop();
  assert.equal(listeners.has("claude:changed"), false);
});

test("the account row shows a skeleton until the store has an account", () => {
  client.claude_store.set(null);
  fresh("ClaudeRow");
  assert.equal(container.textContent, "");
  assert.equal(container.matching((element) => element.tagName === "BUTTON").length, 0);
});

test("a signed-in account shows the email, the subscription and Check again", async () => {
  await show_row({ status: "signed_in", email: "me@example.com", subscription: "max", auth_method: "claude.ai" });
  assert.equal(container.textContent, "me@example.commaxCheck again");
  assert.deepEqual(button_labels(), ["Check again"]);
  await show_row({ status: "signed_in", email: null, subscription: null, auth_method: "claude.ai" });
  assert.equal(container.textContent, "Claude Code loginSigned inCheck again");
  assert.deepEqual(invoked("claude:refresh"), []);
});

test("a signed-out account offers Check again and Sign in", async () => {
  await show_row({ status: "signed_out" });
  assert.match(container.textContent, /^Claude Code loginNot signed in/);
  assert.deepEqual(button_labels(), ["Check again", "Sign in"]);
});

test("another login explains that the Claude plan needs the subscription login and offers Sign in", async () => {
  await show_row({ status: "other_login", auth_method: "api_key" });
  assert.match(container.textContent, /Claude Code is set up with another login, the Claude plan needs the subscription login/);
  assert.deepEqual(button_labels(), ["Check again", "Sign in"]);
});

test("a missing Claude Code shows its hint and no button", async () => {
  await show_row({ status: "missing" });
  assert.equal(container.textContent, "Claude Code loginClaude Code is missing from this installation");
  assert.deepEqual(button_labels(), []);
});

test("an unreadable login state shows the error line with the detail and Check again", async () => {
  await show_row({ status: "error", detail: "exit code 3" });
  const alerts = container.matching((element) => element.getAttribute("role") === "alert");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.textContent, "The login state could not be read: exit code 3");
  assert.deepEqual(button_labels(), ["Check again"]);
  await show_row({ status: "error", detail: "" });
  assert.equal(container.matching((element) => element.getAttribute("role") === "alert")[0]?.textContent, "The login state could not be read");
});

test("an unknown, signed-out or other login refreshes once when the row mounts, and unknown shows no hint", async () => {
  for (const status of ["unknown", "signed_out", "other_login"] as const) {
    calls.length = 0;
    await show_row({ status });
    render("ClaudeRow");
    client.claude_store.set(account({ status }));
    await settled();
    assert.deepEqual(invoked("claude:refresh"), [[]], status);
  }
  await show_row({ status: "unknown" });
  assert.equal(container.textContent, "Claude Code loginCheck again");
});

test("Check again invokes claude:refresh and stores the answer", async () => {
  await show_row({ status: "signed_out" });
  answer = account({ status: "signed_in", email: "me@example.com", subscription: "pro", auth_method: "claude.ai" });
  press(button("Check again"));
  await settled();
  assert.deepEqual(invoked("claude:refresh"), [[], []]);
  assert.deepEqual(client.claude_store.get(), answer);
  assert.match(container.textContent, /me@example\.compro/);
});

test("Sign in types the login command into a terminal tab", async () => {
  await show_row({ status: "signed_out" });
  press(button("Sign in"));
  assert.equal(client.ui_store.get().dock.kind, "terminal");
  const tabs = Object.values(client.terminal_store.get().groups as Record<string, { tabs: { id: string; status: string }[] }>).flatMap((group) => group.tabs);
  const starting = tabs.filter((tab) => tab.status === "starting");
  assert.equal(starting.length, 1);
  const output = { data: () => {}, exit: () => {}, release: () => {} };
  assert.equal(await client.start_terminal(starting[0].id, 80, 24, output), true);
  assert.equal(invoked("terminal:create").length, 1);
  assert.deepEqual(sent, [["terminal:input", "pty-claude", `${login_command}\r`]]);
  assert.deepEqual(invoked("claude:refresh"), [[]]);
});

test("the billing group holds both switches and both account rows in order, and the Claude switch sends claude_billing", async () => {
  current = view("api", "api");
  client.settings_store.set(current);
  client.claude_store.set(account({ status: "signed_out" }));
  fresh("GeneralPane");
  const text = container.textContent;
  const order = ["GPT models", "API pricingChatGPT plan", "Claude models", "API pricingClaude plan", "Claude Code login"].map((part) => text.indexOf(part));
  assert.ok(order.every((at) => at >= 0), `every part is shown in ${text}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const stubs = container.matching((element) => element.getAttribute("data-stub") !== null).map((element) => element.getAttribute("data-stub"));
  assert.deepEqual(stubs, ["ChatgptRow", "SecretRow", "BalanceLine", "AccentRow"]);
  const groups = container.matching((element) => element.getAttribute("role") === "radiogroup").map((element) => element.getAttribute("aria-label"));
  assert.deepEqual(groups, ["Language", "GPT models", "Claude models"]);
  const secret = () => container.matching((element) => element.getAttribute("data-stub") === "SecretRow")[0]?.textContent;
  assert.equal(secret(), "");
  press(button("Claude plan"));
  await settled();
  assert.deepEqual(invoked("settings:update"), [[{ claude_billing: "claude" }]]);
  assert.equal(client.settings_store.get().claude_billing, "claude");
  assert.equal(client.settings_store.get().billing, "api");
  assert.equal(secret(), "Used for image generation, dictation and models outside your plans");
  current = view("chatgpt", "api");
  client.settings_store.set(current);
  render("GeneralPane");
  assert.equal(secret(), "Used for image generation, dictation and models outside your plans");
  current = view("api", "api");
  client.settings_store.set(current);
  render("GeneralPane");
  assert.equal(secret(), "");
});

test("runs_on_claude_plan is true only for a model the Claude plan serves", () => {
  const menu_model = (model: string) => client.choice_view(catalog, { model, effort: "high", pro: false }).model;
  assert.equal(client.runs_on_claude_plan(catalog, menu_model(opus)), true);
  assert.equal(client.runs_on_claude_plan(catalog, menu_model(sol)), false);
  assert.equal(client.runs_on_claude_plan(catalog, menu_model(deepseek)), false);
  assert.equal(client.runs_on_claude_plan(catalog, null), false);
  assert.equal(client.runs_on_claude_plan({ ...catalog, claude_plan_ids: undefined }, menu_model(opus)), false);
  assert.equal(client.runs_on_plan(catalog, menu_model(opus)), false);
});

test("the picker footer follows the model: ChatGPT plan, Claude plan or none", () => {
  const menu = (model: string) => fresh("ModelMenu", { open: false, anchor: null, catalog, choice: { model, effort: "high", pro: false }, view: "models", on_view: () => {}, on_choice: () => {}, on_close: () => {} });
  const footer = () => container.matching((element) => element.className === "model-menu-plan").map((element) => element.textContent);
  const has_footer_class = () => container.matching((element) => element.className.includes("has-plan-footer")).length === 1;
  client.chatgpt_store.set(null);
  client.claude_store.set(account({ status: "signed_in", email: "me@example.com" }));
  menu(opus);
  assert.deepEqual(footer(), ["Using Claude planOpen settings"]);
  assert.equal(has_footer_class(), true);
  assert.equal(container.matching((element) => element.className === "model-menu-plan")[0]?.matching((element) => element.tagName === "svg").length, 1);
  for (const [status, line] of [["signed_out", "Not signed in to Claude Code"], ["other_login", "Not signed in to Claude Code"], ["missing", "Claude Code is missing from this installation"], ["error", "The login state could not be read"], ["unknown", "Using Claude plan"]] as const) {
    client.claude_store.set(account({ status }));
    menu(opus);
    assert.deepEqual(footer(), [`${line}Open settings`], status);
  }
  client.ui_store.update((state: Record<string, unknown>) => ({ ...state, settings_open: false, settings_section: "privacy" }));
  press(button("Open settings"));
  assert.equal(client.ui_store.get().settings_open, true);
  assert.equal(client.ui_store.get().settings_section, "general");
  menu(sol);
  assert.deepEqual(footer(), ["Not signed in to ChatGPTOpen settings"]);
  assert.equal(has_footer_class(), true);
  menu(deepseek);
  assert.deepEqual(footer(), []);
  assert.equal(has_footer_class(), false);
});

test("the models body shows the Claude plan instead of prices for a Claude-plan row", () => {
  const price = (patch: Partial<ModelPrice>): ModelPrice => ({
    id: "deepseek/deepseek-v4.1-flash-1017",
    label: "DeepSeek",
    provider: "deepseek",
    endpoint: "",
    input: 0.1,
    output: 0.4,
    cache_read: null,
    long_context: null,
    context_length: 400_000,
    efforts: [],
    note: "",
    error: "",
    ...patch,
  });
  const models = [
    price({}),
    price({ id: sol, label: "GPT-6.2 Sol", input: null, output: null, plan: true }),
    price({ id: opus, label: "Claude Opus 5.5", input: null, output: null, claude_plan: true, note: "included in the Claude plan, no per-token price" }),
  ];
  fresh("ModelsBody", { view: { kind: "models", models } });
  const rows = container.matching((element) => element.className === "model-prices-row");
  const cells = rows.map((row) => row.children.slice(1).map((cell) => cell.textContent));
  assert.deepEqual(cells, [
    ["$0.10", "$0.40"],
    ["ChatGPT plan", ""],
    ["Claude plan", ""],
  ]);
});

test("both languages have the same billing and tools keys, the Claude ones included", () => {
  assert.deepEqual(Object.keys(de_billing).sort(), Object.keys(en_billing).sort());
  assert.deepEqual(Object.keys(de_tools).sort(), Object.keys(en_tools).sort());
  assert.equal(en_billing["billing.mode"], "GPT models");
  assert.equal(de_billing["billing.mode"], "GPT-Modelle");
  assert.equal(en_billing["billing.mode_claude_plan"], "Claude plan");
  assert.equal(de_billing["billing.mode_claude_plan"], "Claude-Abo");
  assert.equal(de_billing["billing.key_hint_plan"], "Für Bildgenerierung, Diktat und Modelle außerhalb deiner Abos");
  assert.equal(en_tools["tools.model_claude_plan"], "Claude plan");
  assert.equal(de_tools["tools.model_claude_plan"], "Claude-Abo");
});

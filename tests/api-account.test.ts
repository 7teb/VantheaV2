import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { parse_session_options, resolve_run_options } from "../electron/api/options.ts";
import { route, type ApiContext } from "../electron/api/router.ts";
import type { AccountInfo } from "../shared/api/contract.ts";
import type { ChatMeta } from "../shared/chat.ts";
import type { ChatgptAccount } from "../shared/chatgpt.ts";
import type { ClaudeAccount } from "../shared/claude.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { BillingMode, ClaudeBillingMode } from "../shared/settings.ts";

const token = "t".repeat(48);

const model = (id: string): ModelEntry => ({
  id,
  label: id.toUpperCase(),
  provider: "OpenAI",
  provider_order: ["openai"],
  efforts: ["low", "high"],
  default_effort: "low",
  vision: true,
  context_length: 100_000,
  max_output: 8000,
  reasoning_passback: false,
});

const models = [model("openai/gpt-6.2-sol"), model("openai/gpt-6-luna"), model("vendor/other")];

const account = (patch: Partial<ChatgptAccount> = {}): ChatgptAccount => ({
  status: "signed_out",
  email: null,
  name: null,
  plan_enabled: false,
  notice_seen: false,
  error: null,
  ...patch,
});

const claude = (patch: Partial<ClaudeAccount> = {}): ClaudeAccount => ({
  status: "unknown",
  email: null,
  subscription: null,
  auth_method: null,
  login_command: "",
  detail: "",
  ...patch,
});

const login_command = "& 'C:/Claude Code/claude.exe' auth login --claudeai";

type Call = { name: string; args: unknown[] };

const state = {
  calls: [] as Call[],
  billing: "api" as BillingMode,
  claude_billing: "api" as ClaudeBillingMode,
  chatgpt: account(),
  claude: claude(),
  metas: new Map<string, ChatMeta>(),
};

const settings_view = () => ({ billing: state.billing, claude_billing: state.claude_billing, model: "openai/gpt-6.2-sol" });

const meta = (id: string, choice: ChatMeta["choice"]): ChatMeta => ({
  id,
  title: "",
  project_path: "",
  workspace: "",
  choice,
  pinned: false,
  created_at: "2026-11-21T00:00:00.000Z",
  updated_at: "2026-11-21T00:00:00.000Z",
  message_count: 2,
  streaming: false,
});

const invoke = async (name: string, ...args: unknown[]): Promise<unknown> => {
  state.calls.push({ name, args });
  if (name === "settings:get") {
    return settings_view();
  }
  if (name === "settings:update") {
    const patch = args[0] as { billing?: BillingMode; claude_billing?: ClaudeBillingMode };
    state.billing = patch.billing ?? state.billing;
    state.claude_billing = patch.claude_billing ?? state.claude_billing;
    return settings_view();
  }
  if (name === "claude:status") {
    return state.claude;
  }
  if (name === "claude:refresh") {
    state.claude = claude({ status: "signed_in", email: "owner@example.invalid", subscription: "max", auth_method: "claude.ai", login_command });
    return state.claude;
  }
  if (name === "chatgpt:status") {
    return state.chatgpt;
  }
  if (name === "chatgpt:sign_in") {
    state.chatgpt = account({ status: "signing_in" });
    return state.chatgpt;
  }
  if (name === "chatgpt:sign_out") {
    state.chatgpt = account({ email: "owner@example.invalid" });
    return state.chatgpt;
  }
  throw new Error(`unexpected ${name}`);
};

let server: http.Server;
let base = "";
let context: ApiContext;

before(async () => {
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  context = {
    token,
    port,
    invoke: invoke as ApiContext["invoke"],
    add_event_tap: () => () => {},
    session_meta: (id) => state.metas.get(id) ?? null,
    is_active: () => false,
    active_message: () => null,
    turn_settled: async () => {},
    ended_turn_settled: async () => {},
    chat_activity: () => ({ turn: false, agents: 0, workflows: 0, background: 0, queued: 0 }),
    chat_idle: () => true,
    when_idle: async () => {},
    pending_approvals: () => [],
    uploaded: () => [],
    protected_dirs: [],
    run_options: () => null,
    set_run_options: () => {},
    forget_run_options: () => {},
    settings: () => ({ model: "openai/gpt-6-luna", effort: "high" }),
    model_catalog: async () => ({
      models,
      side: { title: "s", overseer: "s", vision: "s", reasoning_status: "s", transcription: "s", git_text: "s" },
      side_models: [],
      image_models: [],
    }),
    version: "9.9.9",
    headless: true,
    quit: () => {},
  };
  server.on("request", (request, response) => route(context, request, response));
});

beforeEach(() => {
  state.calls.length = 0;
  state.billing = "api";
  state.claude_billing = "api";
  state.chatgpt = account();
  state.claude = claude();
  state.metas.clear();
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const send = (method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const error_of = async (response: Response) => ((await response.json()) as { error: { code: string; message: string } }).error;

const names = () => state.calls.map((call) => call.name);

test("GET /v1/account reports both billing modes, the ChatGPT account and the Claude Code login", async () => {
  state.billing = "chatgpt";
  state.claude_billing = "claude";
  state.chatgpt = account({ status: "signed_in", email: "owner@example.invalid", plan_enabled: true });
  state.claude = claude({ status: "signed_out", login_command });
  const response = await send("GET", "/v1/account");
  assert.equal(response.status, 200);
  const info = (await response.json()) as AccountInfo;
  assert.deepEqual(info, { billing: "chatgpt", chatgpt: state.chatgpt, claude_billing: "claude", claude: state.claude });
  assert.deepEqual(names(), ["settings:get", "chatgpt:status", "claude:status"]);
});

test("POST /v1/account/billing switches billing through settings:update and returns the account", async () => {
  const response = await send("POST", "/v1/account/billing", { billing: "chatgpt" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { billing: "chatgpt", chatgpt: account(), claude_billing: "api", claude: claude() });
  assert.deepEqual(state.calls, [
    { name: "settings:update", args: [{ billing: "chatgpt" }] },
    { name: "chatgpt:status", args: [] },
    { name: "claude:status", args: [] },
  ]);
});

test("POST /v1/account/billing refuses a missing, unknown or non-JSON billing value before any channel", async () => {
  const cases: [unknown, Record<string, string>][] = [
    [{}, {}],
    [{ billing: "free" }, {}],
    [{ billing: 1 }, {}],
    ["{not json", {}],
    [JSON.stringify({ billing: "api" }), { "content-type": "text/plain" }],
  ];
  for (const [body, headers] of cases) {
    const response = await send("POST", "/v1/account/billing", body, headers);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await error_of(response)).code, "invalid_request");
  }
  const message = (await error_of(await send("POST", "/v1/account/billing", { billing: "free" }))).message;
  assert.equal(message, "billing must be one of api, chatgpt");
  assert.equal((await send("POST", "/v1/account/billing", { billing: "claude" })).status, 400);
  assert.deepEqual(state.calls, []);
});

test("POST /v1/account/chatgpt/sign_in starts the sign-in with the flags or their defaults", async () => {
  const plain = await send("POST", "/v1/account/chatgpt/sign_in");
  assert.equal(plain.status, 200);
  assert.deepEqual(await plain.json(), { billing: "api", chatgpt: account({ status: "signing_in" }), claude_billing: "api", claude: claude() });
  const empty = await send("POST", "/v1/account/chatgpt/sign_in", {});
  assert.equal(empty.status, 200);
  const flagged = await send("POST", "/v1/account/chatgpt/sign_in", { fresh: true, consent: true });
  assert.equal(flagged.status, 200);
  assert.deepEqual(
    state.calls.filter((call) => call.name === "chatgpt:sign_in").map((call) => call.args),
    [[{ fresh: false, consent: false }], [{ fresh: false, consent: false }], [{ fresh: true, consent: true }]],
  );
  assert.deepEqual(
    names().filter((name) => name !== "chatgpt:sign_in"),
    ["settings:get", "claude:status", "settings:get", "claude:status", "settings:get", "claude:status"],
  );
});

test("POST /v1/account/chatgpt/sign_in refuses flags that are not booleans and bodies without a JSON type", async () => {
  for (const body of [{ fresh: "yes" }, { consent: 1 }, "[true]"]) {
    const response = await send("POST", "/v1/account/chatgpt/sign_in", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await error_of(response)).code, "invalid_request");
  }
  const untyped = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = http.request(`${base}/v1/account/chatgpt/sign_in`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "5" } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
    });
    request.on("error", reject);
    request.end("fresh");
  });
  assert.equal(untyped.status, 400);
  assert.match(untyped.text, /the content type must be application\/json/);
  assert.deepEqual(state.calls, []);
});

test("POST /v1/account/chatgpt/sign_out reaches chatgpt:sign_out and returns the signed-out account", async () => {
  state.chatgpt = account({ status: "signed_in", email: "owner@example.invalid", plan_enabled: true });
  const response = await send("POST", "/v1/account/chatgpt/sign_out");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { billing: "api", chatgpt: account({ email: "owner@example.invalid" }), claude_billing: "api", claude: claude() });
  assert.deepEqual(names(), ["chatgpt:sign_out", "settings:get", "claude:status"]);
});

test("POST /v1/account/claude-billing switches only the Claude billing through settings:update and returns the account", async () => {
  state.billing = "chatgpt";
  const response = await send("POST", "/v1/account/claude-billing", { billing: "claude" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { billing: "chatgpt", chatgpt: account(), claude_billing: "claude", claude: claude() });
  assert.deepEqual(state.calls, [
    { name: "settings:update", args: [{ claude_billing: "claude" }] },
    { name: "chatgpt:status", args: [] },
    { name: "claude:status", args: [] },
  ]);
  const back = await send("POST", "/v1/account/claude-billing", { billing: "api" });
  assert.equal(((await back.json()) as AccountInfo).claude_billing, "api");
  assert.equal(state.billing, "chatgpt");
});

test("POST /v1/account/claude-billing refuses a missing, unknown or non-JSON billing value before any channel", async () => {
  const cases: [unknown, Record<string, string>][] = [
    [{}, {}],
    [{ billing: "chatgpt" }, {}],
    [{ billing: "free" }, {}],
    [{ billing: true }, {}],
    [{ claude_billing: "claude" }, {}],
    ["{not json", {}],
    [JSON.stringify(["claude"]), {}],
    [JSON.stringify({ billing: "claude" }), { "content-type": "text/plain" }],
  ];
  for (const [body, headers] of cases) {
    const response = await send("POST", "/v1/account/claude-billing", body, headers);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await error_of(response)).code, "invalid_request");
  }
  const message = (await error_of(await send("POST", "/v1/account/claude-billing", { billing: "free" }))).message;
  assert.equal(message, "billing must be one of api, claude");
  assert.equal((await send("POST", "/v1/account/claude-billing")).status, 400);
  assert.deepEqual(state.calls, []);
});

test("POST /v1/account/claude/refresh reads the Claude Code login again and returns it with the account", async () => {
  const response = await send("POST", "/v1/account/claude/refresh");
  assert.equal(response.status, 200);
  const info = (await response.json()) as AccountInfo;
  assert.equal(info.claude.status, "signed_in");
  assert.deepEqual(info, { billing: "api", chatgpt: account(), claude_billing: "api", claude: state.claude });
  assert.deepEqual(names(), ["claude:refresh", "settings:get", "chatgpt:status"]);
});

test("the account routes need the bearer token like every other route", async () => {
  for (const [method, pathname] of [
    ["GET", "/v1/account"],
    ["POST", "/v1/account/billing"],
    ["POST", "/v1/account/chatgpt/sign_in"],
    ["POST", "/v1/account/chatgpt/sign_out"],
    ["POST", "/v1/account/claude-billing"],
    ["POST", "/v1/account/claude/refresh"],
  ]) {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: "Bearer nope" } });
    assert.equal(response.status, 401, pathname);
  }
  assert.deepEqual(state.calls, []);
});

test("models lists the whole catalog in either billing mode, info the settings default, and every choice validates against the catalog", async () => {
  for (const billing of ["api", "chatgpt"] as const) {
    state.billing = billing;
    assert.deepEqual(await (await send("GET", "/v1/models")).json(), [
      { id: "openai/gpt-6.2-sol", label: "OPENAI/GPT-6.2-SOL", efforts: ["low", "high"] },
      { id: "openai/gpt-6-luna", label: "OPENAI/GPT-6-LUNA", efforts: ["low", "high"] },
      { id: "vendor/other", label: "VENDOR/OTHER", efforts: ["low", "high"] },
    ]);
    assert.equal(((await (await send("GET", "/v1/info")).json()) as { default_model: string }).default_model, "openai/gpt-6-luna");
    assert.deepEqual(await parse_session_options(context, { model: "vendor/other" }), { model: "vendor/other" });
    await assert.rejects(parse_session_options(context, { model: "vendor/missing" }), /not in the model catalog/);
    assert.deepEqual((await resolve_run_options(context, "chat-none", {})).choice, { model: "openai/gpt-6-luna", effort: "high", pro: false });
    state.metas.set("chat-vendor", meta("chat-vendor", { model: "vendor/other", effort: "low", pro: false }));
    assert.deepEqual((await resolve_run_options(context, "chat-vendor", {})).choice, { model: "vendor/other", effort: "low", pro: false });
  }
});

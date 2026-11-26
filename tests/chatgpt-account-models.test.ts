import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, mock, test } from "node:test";
import { models_endpoint, token_endpoint } from "../electron/chatgpt/endpoints.ts";
import { account_models, init_chatgpt, refresh_account_models, shutdown_chatgpt } from "../electron/chatgpt/service.ts";
import { parse_account_model } from "../electron/chatgpt/store.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { account_kit, sign_in_with, signed_in_kit, temp_root, token_values, type AccountKit } from "./support/fake-openai-auth.ts";

let root = "";
const logged: string[] = [];

before(async () => {
  root = await temp_root();
  mock.method(console, "log", () => undefined);
  mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

after(async () => {
  shutdown_chatgpt();
  mock.restoreAll();
  await fs.rm(root, { recursive: true, force: true });
});

const listing = [
  {
    slug: "gpt-6.2-sol",
    display_name: "GPT-6.2 Sol",
    visibility: "list",
    context_window: 500000,
    supported_in_api: true,
    service_tiers: [{ id: "priority", name: "Fast" }, { id: "ultrafast", name: "Ultrafast" }, { name: "no id" }, 7],
  },
  { slug: "gpt-6-hidden", display_name: "Hidden", visibility: "hide", context_window: 128000 },
  { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list", context_window: 0, service_tiers: "priority" },
  { slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", visibility: "list", context_window: 1.5 },
  { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list", context_window: "500000" },
  { slug: "no-name", visibility: "list" },
  { display_name: "No slug", visibility: "list" },
  { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", context_window: -4 },
  "not an entry",
];

const expected = [
  { slug: "gpt-6.2-sol", display_name: "GPT-6.2 Sol", context_window: 500000, service_tiers: ["priority", "ultrafast"] },
  { slug: "gpt-6-luna", display_name: "GPT-6 Luna", context_window: null, service_tiers: [] },
  { slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", context_window: null, service_tiers: [] },
  { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", context_window: null, service_tiers: [] },
  { slug: "gpt-5.5", display_name: "GPT-5.5", context_window: null, service_tiers: [] },
];

const plain = async (kit: AccountKit) => {
  await writes_settled(kit.deps.file);
  return JSON.parse(await fs.readFile(kit.deps.file, "utf8"));
};

test("the model list keeps listed entries in server order with a positive integer context window", async () => {
  const kit = account_kit(root, "filter");
  kit.fake.models = listing;
  await init_chatgpt(kit.deps);
  await sign_in_with(kit);
  assert.deepEqual(account_models(), expected);
  assert.deepEqual((await plain(kit)).models, expected);
  const [request] = kit.fake.requests.filter((entry) => entry.url === models_endpoint);
  assert.equal(request?.method, "GET");
  assert.equal(request?.headers.authorization, `Bearer ${kit.stored().account.tokens.access_token}`);
  const text = JSON.stringify(await plain(kit));
  for (const value of token_values(kit)) {
    assert.equal(text.includes(value), false);
  }
});

test("the plan window is the model max_context_window and falls back to context_window when that is missing or invalid", () => {
  const model = (fields: Record<string, unknown>) => parse_account_model({ slug: "gpt-6.2-sol", display_name: "GPT-6.2 Sol", ...fields })?.context_window;
  assert.equal(model({ context_window: 500000, max_context_window: 872000 }), 872000);
  assert.equal(model({ context_window: 500000 }), 500000);
  assert.equal(model({ context_window: 500000, max_context_window: 0 }), 500000);
  assert.equal(model({ context_window: 500000, max_context_window: "872000" }), 500000);
  assert.equal(model({ max_context_window: 872000 }), 872000);
  assert.equal(model({}), null);
});

test("models_changed fires only when the list differs", async () => {
  const kit = await signed_in_kit(root, "changes");
  kit.fake.models = listing;
  const before_count = kit.models_changed;
  await refresh_account_models();
  assert.equal(kit.models_changed, before_count + 1);
  await refresh_account_models();
  assert.equal(kit.models_changed, before_count + 1);
  kit.fake.models = listing.slice(0, 1);
  await refresh_account_models();
  assert.equal(kit.models_changed, before_count + 2);
  assert.deepEqual(account_models(), expected.slice(0, 1));
});

test("a 401 renews the token once and repeats the request only once", async () => {
  const kit = await signed_in_kit(root, "renewal");
  kit.fake.models = listing;
  const rejected = kit.stored().account.tokens.access_token;
  kit.fake.valid_access.clear();
  await refresh_account_models();
  assert.deepEqual(account_models(), expected);
  const requests = kit.fake.requests.filter((entry) => entry.url === models_endpoint).slice(-2);
  assert.equal(requests[0]?.headers.authorization, `Bearer ${rejected}`);
  assert.equal(requests[1]?.headers.authorization, `Bearer ${kit.stored().account.tokens.access_token}`);
  assert.notEqual(rejected, kit.stored().account.tokens.access_token);
  assert.equal(kit.fake.forms(token_endpoint).filter((form) => form.get("grant_type") === "refresh_token").length, 1);
  kit.fake.valid_access.clear();
  const calls = kit.fake.count(models_endpoint);
  const fake_fetch = kit.deps.fetch;
  let refreshed = false;
  kit.deps.fetch = async (url, init) => {
    const response = await fake_fetch(url, init);
    if (url === token_endpoint) {
      refreshed = true;
      kit.fake.valid_access.clear();
    }
    return response;
  };
  logged.length = 0;
  await refresh_account_models();
  assert.equal(refreshed, true);
  assert.equal(kit.fake.count(models_endpoint), calls + 2);
  assert.deepEqual(account_models(), expected);
  assert.ok(logged.some((line) => line.includes("HTTP 401")));
});

test("a failed request keeps the previous list and is logged", async () => {
  const kit = account_kit(root, "failure");
  kit.fake.models = listing;
  await init_chatgpt(kit.deps);
  await sign_in_with(kit);
  const count = kit.models_changed;
  logged.length = 0;
  kit.fake.models_replies.push({ status: 500, body: { error: { message: "down" } }, headers: { "x-request-id": "req-1" } });
  await refresh_account_models();
  kit.fake.models_replies.push({ status: 200, body: { data: [] } });
  await refresh_account_models();
  kit.fake.models_replies.push({ status: 200, body: "not json" });
  await refresh_account_models();
  assert.deepEqual(account_models(), expected);
  assert.deepEqual((await plain(kit)).models, expected);
  assert.equal(kit.models_changed, count);
  assert.ok(logged.some((line) => line.includes("HTTP 500 (request req-1)")));
  assert.ok(logged.some((line) => line.includes("no models array")));
  assert.ok(logged.some((line) => line.includes("not valid JSON")));
});

test("init loads the cached list and refreshes it in the background when tokens are stored", async () => {
  const kit = account_kit(root, "startup");
  kit.fake.models = listing.slice(0, 1);
  await init_chatgpt(kit.deps);
  await sign_in_with(kit);
  assert.deepEqual(account_models(), expected.slice(0, 1));
  kit.fake.models = listing;
  const count = kit.models_changed;
  await init_chatgpt(kit.deps);
  assert.deepEqual(account_models(), expected.slice(0, 1));
  await kit.wait_models(count + 1);
  assert.deepEqual(account_models(), expected);
});

test("without a sign-in nothing is requested", async () => {
  const kit = account_kit(root, "signed-out");
  await init_chatgpt(kit.deps);
  await refresh_account_models();
  assert.equal(kit.fake.requests.length, 0);
  assert.equal(account_models(), null);
});

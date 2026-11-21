import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, mock, test } from "node:test";
import { revocation_endpoint, token_endpoint } from "../electron/chatgpt/endpoints.ts";
import { access_token, account_models, chatgpt_account, dismiss_notice, init_chatgpt, shutdown_chatgpt, sign_out } from "../electron/chatgpt/service.ts";
import { retry_backoff_ms } from "../electron/model/errors.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { account_kit, oauth_error, sign_in_with, signed_in_kit, temp_root, token_values, type AccountKit } from "./support/fake-openai-auth.ts";

let root = "";

before(async () => {
  root = await temp_root();
  mock.method(console, "log", () => undefined);
  mock.method(console, "error", () => undefined);
});

after(async () => {
  shutdown_chatgpt();
  mock.restoreAll();
  await fs.rm(root, { recursive: true, force: true });
});

const plain = async (kit: AccountKit) => {
  await writes_settled(kit.deps.file);
  return JSON.parse(await fs.readFile(kit.deps.file, "utf8"));
};

const signed_in_with_models = async (name: string) => {
  const kit = account_kit(root, name);
  kit.fake.models = [{ slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list" }];
  await init_chatgpt(kit.deps);
  await sign_in_with(kit);
  assert.deepEqual(account_models(), [{ slug: "gpt-6-luna", display_name: "GPT-6 Luna", context_window: null }]);
  return kit;
};

test("a confirmed sign-out revokes the refresh token and keeps identity, client id and host id", async () => {
  const kit = await signed_in_with_models("confirmed");
  const record = kit.stored();
  const host_id = (await plain(kit)).host_id;
  const models = kit.models_changed;
  const account = await sign_out();
  const forms = kit.fake.forms(revocation_endpoint);
  assert.equal(forms.length, 1);
  assert.deepEqual([...(forms[0]?.entries() ?? [])], [
    ["token", record.account.tokens.refresh_token],
    ["token_type_hint", "refresh_token"],
    ["client_id", "oaiapp_fake_1"],
  ]);
  assert.deepEqual(account, { status: "signed_out", email: "ada@example.com", name: "Ada", plan_enabled: false, notice_seen: false, error: null });
  const stored = kit.stored();
  assert.equal(stored.account.tokens, null);
  assert.equal(stored.account.expired, false);
  assert.equal(stored.account.client_id, "oaiapp_fake_1");
  assert.equal(stored.account.subject, "user-ada");
  assert.equal(stored.account.email, "ada@example.com");
  const state = await plain(kit);
  assert.equal(state.host_id, host_id);
  assert.equal(state.models, null);
  assert.equal(account_models(), null);
  assert.equal(kit.models_changed, models + 1);
  assert.equal(kit.sleeps.length, 0);
  await assert.rejects(access_token(), /Not signed in/);
  const text = JSON.stringify(state) + kit.vault.stored;
  for (const value of token_values(kit)) {
    assert.equal(text.includes(value), false);
  }
});

test("an unconfirmed revocation retries once after the first backoff step and still clears the tokens", async () => {
  const kit = await signed_in_kit(root, "unconfirmed");
  kit.fake.revoke_replies.push("network", { status: 503, body: { error: "temporarily_unavailable" } });
  const account = await sign_out();
  assert.equal(kit.fake.count(revocation_endpoint), 2);
  assert.deepEqual(kit.sleeps, [retry_backoff_ms[0]]);
  assert.equal(account.status, "signed_out");
  assert.equal(account.error?.code, "revocation_unconfirmed");
  assert.match(account.error?.detail ?? "", /HTTP 503 temporarily_unavailable/);
  assert.equal(kit.stored().account.tokens, null);
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_1");
});

test("a refused revocation is not retried and is reported as unconfirmed", async () => {
  const kit = await signed_in_kit(root, "refused");
  kit.fake.revoke_replies.push({ status: 400, body: { error: "invalid_client" } });
  const account = await sign_out();
  assert.equal(kit.fake.count(revocation_endpoint), 1);
  assert.equal(kit.sleeps.length, 0);
  assert.equal(account.error?.code, "revocation_unconfirmed");
  assert.equal(kit.stored().account.tokens, null);
});

test("signing out again sends no second revocation", async () => {
  const kit = await signed_in_kit(root, "twice");
  await sign_out();
  const account = await sign_out();
  assert.equal(account.status, "signed_out");
  assert.equal(account.error, null);
  assert.equal(kit.fake.count(revocation_endpoint), 1);
});

test("signing out an expired sign-in only clears the expired flag", async () => {
  const kit = await signed_in_kit(root, "expired");
  kit.advance(3600 * 1000);
  kit.fake.token_replies.push(oauth_error("refresh_token_expired"));
  await assert.rejects(access_token(), /has expired/);
  assert.equal(chatgpt_account().status, "expired");
  const account = await sign_out();
  assert.equal(account.status, "signed_out");
  assert.equal(account.error, null);
  assert.equal(kit.fake.count(revocation_endpoint), 0);
  assert.equal(kit.stored().account.expired, false);
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_1");
});

test("after a sign-out the next sign-in reuses the saved client id with the email as login hint", async () => {
  const kit = await signed_in_kit(root, "return");
  await sign_out();
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  const params = new URL(kit.opened.at(-1) ?? "").searchParams;
  assert.equal(params.get("client_id"), "oaiapp_fake_1");
  assert.equal(params.get("login_hint"), "ada@example.com");
  assert.equal(params.has("id_token_hint"), false);
});

test("the host id survives a sign-out and a restart, and the notice flag is kept", async () => {
  const kit = await signed_in_kit(root, "restart");
  const host_id = (await plain(kit)).host_id;
  const dismissed = await dismiss_notice();
  assert.equal(dismissed.notice_seen, true);
  await sign_out();
  await init_chatgpt(kit.deps);
  assert.equal(chatgpt_account().notice_seen, true);
  assert.equal(chatgpt_account().email, "ada@example.com");
  assert.equal(chatgpt_account().status, "signed_out");
  await sign_in_with(kit);
  const params = new URL(kit.opened.at(-1) ?? "").searchParams;
  assert.equal(params.get("ext_agent_host_id"), host_id);
  assert.equal((await plain(kit)).host_id, host_id);
});

test("a token request during the revocation finds no tokens and starts no refresh", async () => {
  const kit = await signed_in_kit(root, "racing");
  kit.advance(3600 * 1000);
  let release: () => void = () => undefined;
  kit.fake.revoke_gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signing_out = sign_out();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kit.fake.count(revocation_endpoint), 1);
  await assert.rejects(access_token(), /Not signed in/);
  kit.fake.revoke_gate = null;
  release();
  const account = await signing_out;
  assert.equal(account.status, "signed_out");
  assert.equal(account.error, null);
  assert.equal(kit.fake.forms(token_endpoint).filter((form) => form.get("grant_type") === "refresh_token").length, 0);
  assert.equal(kit.fake.valid_refresh.size, 0);
});

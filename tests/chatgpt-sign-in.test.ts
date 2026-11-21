import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, mock, test } from "node:test";
import { models_endpoint, registration_client_id, revocation_endpoint, scope, token_endpoint } from "../electron/chatgpt/endpoints.ts";
import { access_token, account_models, cancel_sign_in, chatgpt_account, init_chatgpt, shutdown_chatgpt, start_sign_in } from "../electron/chatgpt/service.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { account_kit, oauth_error, settled, sign_in_with, signed_in_kit, temp_root, token_values, type AccountKit } from "./support/fake-openai-auth.ts";

let root = "";
const logged: string[] = [];

before(async () => {
  root = await temp_root();
  const keep = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  mock.method(console, "log", keep);
  mock.method(console, "error", keep);
});

after(async () => {
  shutdown_chatgpt();
  mock.restoreAll();
  await fs.rm(root, { recursive: true, force: true });
});

const plain_file = async (kit: AccountKit) => {
  await writes_settled(kit.deps.file);
  return fs.readFile(kit.deps.file, "utf8");
};

const assert_no_secrets = async (kit: AccountKit) => {
  const shown = JSON.stringify([chatgpt_account(), ...kit.changes]);
  const plain = await plain_file(kit);
  const secrets = token_values(kit);
  for (const url of kit.opened) {
    const params = new URL(url).searchParams;
    secrets.push(url, params.get("state") ?? "", params.get("nonce") ?? "", params.get("code_challenge") ?? "");
  }
  for (const value of secrets.filter((entry) => entry !== "")) {
    assert.equal(shown.includes(value), false, "account view leaks a secret");
    assert.equal(plain.includes(value), false, "plain file leaks a secret");
    assert.equal(logged.some((line) => line.includes(value)), false, "a log line leaks a secret");
  }
};

test("a first sign-in stores the issued client id, loads the model list and leaks no token", async () => {
  const kit = account_kit(root, "success");
  kit.fake.models = [{ slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list", context_window: 400000 }];
  await init_chatgpt(kit.deps);
  const mark = kit.changes.length;
  const started = await start_sign_in({ fresh: false, consent: false });
  assert.equal(started.status, "signing_in");
  assert.equal(kit.changes[mark]?.status, "signing_in");
  const account = await kit.wait_for(settled, mark);
  assert.deepEqual(account, { status: "signed_in", email: "ada@example.com", name: "Ada", plan_enabled: true, notice_seen: false, error: null });
  const [page] = await Promise.all(kit.pages);
  assert.equal(page?.status, 200);
  assert.ok(page?.text.includes("Sign-in received. Return to VantheaX."));
  const stored = kit.stored();
  assert.equal(stored.pending_client_id, null);
  assert.equal(stored.account.client_id, "oaiapp_fake_1");
  assert.equal(stored.account.subject, "user-ada");
  assert.equal(stored.account.issuer, "https://auth.openai.com");
  assert.deepEqual(stored.account.tokens.scopes, scope.split(" "));
  assert.equal(stored.account.tokens.expires_at, 1_800_000_000_000 + 3600 * 1000);
  assert.equal(kit.vault.writes.some((entry) => entry.includes(registration_client_id)), false);
  const [exchange] = kit.fake.requests.filter((entry) => entry.url === token_endpoint);
  assert.deepEqual([...(exchange?.form.keys() ?? [])], ["grant_type", "client_id", "code", "code_verifier", "redirect_uri", "resource"]);
  assert.equal(exchange?.form.get("client_id"), "oaiapp_fake_1");
  assert.equal(exchange?.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(exchange?.form.get("redirect_uri"), new URL(kit.opened[0] ?? "").searchParams.get("redirect_uri"));
  await kit.wait_models(1);
  assert.deepEqual(account_models(), [{ slug: "gpt-6-luna", display_name: "GPT-6 Luna", context_window: 400000 }]);
  assert.ok(kit.models_changed >= 1);
  assert.ok(logged.includes("[chatgpt] opened the ChatGPT sign-in page at https://auth.openai.com/api/accounts/authorize"));
  await assert_no_secrets(kit);
});

test("a callback without an issued client id is an incomplete registration and nothing is exchanged", async () => {
  const kit = account_kit(root, "incomplete");
  kit.callback = { client_id: null };
  await init_chatgpt(kit.deps);
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_out");
  assert.equal(account.error?.code, "registration_incomplete");
  assert.equal(kit.fake.count(token_endpoint), 0);
  assert.equal(kit.stored(), null);
  kit.callback = { client_id: registration_client_id };
  assert.equal((await sign_in_with(kit)).error?.code, "registration_incomplete");
  assert.equal(kit.fake.count(token_endpoint), 0);
});

test("a declined consent ends the attempt without an exchange", async () => {
  const kit = account_kit(root, "declined");
  kit.callback = { code: null, client_id: null, error: "access_denied" };
  await init_chatgpt(kit.deps);
  const account = await sign_in_with(kit);
  assert.deepEqual(account.error, { code: "declined", detail: "" });
  assert.ok((await kit.pages[0])?.text.includes("Sign-in was not completed."));
  kit.callback = { code: null, client_id: null, error: "server_error" };
  assert.deepEqual((await sign_in_with(kit)).error, { code: "declined", detail: "server_error" });
  assert.equal(kit.fake.count(token_endpoint), 0);
});

test("a returning sign-in with another account stores nothing and revokes the new refresh token once", async () => {
  const kit = await signed_in_kit(root, "wrong-account");
  const before_record = kit.vault.stored;
  kit.fake.account = { sub: "user-bob", email: "bob@example.com", name: "Bob" };
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  assert.equal(account.email, "ada@example.com");
  assert.deepEqual(account.error, { code: "wrong_account", detail: "ada@example.com" });
  assert.equal(kit.vault.stored, before_record);
  const revokes = kit.fake.forms(revocation_endpoint);
  assert.equal(revokes.length, 1);
  assert.notEqual(revokes[0]?.get("token"), kit.stored().account.tokens.refresh_token);
  assert.equal(revokes[0]?.get("token_type_hint"), "refresh_token");
  assert.equal(revokes[0]?.get("client_id"), "oaiapp_fake_1");
});

test("a sign-in without the plan scope stays signed in with plan usage disabled", async () => {
  const kit = account_kit(root, "no-plan");
  kit.fake.granted_scope = "openid profile email offline_access";
  await init_chatgpt(kit.deps);
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  assert.equal(account.plan_enabled, false);
  await assert.rejects(access_token(), (error: Error & { kind?: string }) => error.kind === "plan_auth" && /does not allow plan usage/.test(error.message));
  assert.equal(kit.fake.count(models_endpoint), 0);
});

test("cancel closes the listener and restores the previous status without an error", async () => {
  const kit = await signed_in_kit(root, "cancel");
  kit.browse = false;
  await start_sign_in({ fresh: false, consent: false });
  assert.equal(chatgpt_account().status, "signing_in");
  const redirect = new URL(kit.opened.at(-1) ?? "").searchParams.get("redirect_uri") ?? "";
  const account = cancel_sign_in();
  assert.equal(account.status, "signed_in");
  assert.equal(account.error, null);
  await assert.rejects(fetch(`${redirect}?state=x`));
  const outside = account_kit(root, "cancel-out");
  await init_chatgpt(outside.deps);
  outside.browse = false;
  await start_sign_in({ fresh: false, consent: false });
  assert.equal(cancel_sign_in().status, "signed_out");
});

test("a second attempt replaces the first, whose callback is no longer accepted", async () => {
  const kit = account_kit(root, "replace");
  await init_chatgpt(kit.deps);
  kit.browse = false;
  await start_sign_in({ fresh: false, consent: false });
  const first = kit.opened[0] ?? "";
  kit.browse = true;
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  assert.equal(kit.changes.some((entry) => entry.error !== null), false);
  await assert.rejects(fetch(kit.fake.authorize(first)));
});

test("without safeStorage the sign-in fails with storage_unavailable before anything opens", async () => {
  const kit = account_kit(root, "no-storage", { available: false });
  await init_chatgpt(kit.deps);
  const account = await start_sign_in({ fresh: false, consent: false });
  assert.equal(account.status, "signed_out");
  assert.equal(account.error?.code, "storage_unavailable");
  assert.equal(kit.opened.length, 0);
  assert.equal(kit.fake.requests.length, 0);
  assert.equal(kit.vault.writes.length, 0);
});

test("invalid_grant keeps the issued client id pending and the next attempt reuses it", async () => {
  const kit = account_kit(root, "pending");
  await init_chatgpt(kit.deps);
  kit.fake.token_replies.push(oauth_error("invalid_grant"));
  const failed = await sign_in_with(kit);
  assert.deepEqual(failed.error, { code: "token_invalid", detail: "invalid_grant" });
  assert.equal(kit.stored().pending_client_id, "oaiapp_fake_1");
  assert.equal(kit.stored().account, null);
  kit.fake.issued_client_id = "oaiapp_never_used";
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  const second = new URL(kit.opened[1] ?? "").searchParams;
  assert.equal(second.get("client_id"), "oaiapp_fake_1");
  assert.equal(second.get("agent_name_hint"), null);
  assert.equal(kit.stored().pending_client_id, null);
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_1");
});

test("a declined attempt with the pending client id clears it", async () => {
  const kit = account_kit(root, "pending-declined");
  await init_chatgpt(kit.deps);
  kit.fake.token_replies.push(oauth_error("invalid_grant"));
  await sign_in_with(kit);
  assert.equal(kit.stored().pending_client_id, "oaiapp_fake_1");
  kit.callback = { code: null, error: "access_denied" };
  assert.equal((await sign_in_with(kit)).error?.code, "declined");
  assert.equal(kit.stored().pending_client_id, null);
});

test("a callback naming another client id in a returning flow is rejected", async () => {
  const kit = await signed_in_kit(root, "other-client");
  kit.callback = { client_id: "oaiapp_other" };
  const exchanges = kit.fake.count(token_endpoint);
  const account = await sign_in_with(kit);
  assert.equal(account.error?.code, "token_invalid");
  assert.equal(kit.fake.count(token_endpoint), exchanges);
});

test("a browser that cannot be opened closes the listener and reports open_failed without the address", async () => {
  const kit = account_kit(root, "open-failed");
  await init_chatgpt(kit.deps);
  kit.open_failure = (url) => new Error(`no handler for ${url}`);
  const account = await start_sign_in({ fresh: false, consent: false });
  assert.equal(account.status, "signed_out");
  assert.equal(account.error?.code, "open_failed");
  const url = kit.opened[0] ?? "";
  const params = new URL(url).searchParams;
  for (const value of [url, params.get("state") ?? "-", params.get("nonce") ?? "-"]) {
    assert.equal(account.error?.detail.includes(value), false);
    assert.equal(logged.some((line) => line.includes(value)), false);
  }
  await assert.rejects(fetch(`${params.get("redirect_uri")}?state=x`));
});

test("a token response without the ID token fails and stores nothing", async () => {
  const kit = account_kit(root, "no-id-token");
  await init_chatgpt(kit.deps);
  kit.fake.token_replies.push({ status: 200, body: { access_token: "at-x-secret", refresh_token: "rt-x-secret", token_type: "Bearer", expires_in: 3600, scope } });
  const account = await sign_in_with(kit);
  assert.deepEqual(account.error, { code: "token_invalid", detail: "the token response has no id_token" });
  assert.equal(kit.stored().account, null);
  assert.equal(kit.fake.forms(revocation_endpoint)[0]?.get("token"), "rt-x-secret");
  kit.fake.token_replies.push("network");
  assert.equal((await sign_in_with(kit)).error?.code, "network");
});

test("an exchange error other than invalid_grant drops the pending client id and the next attempt registers again", async () => {
  const kit = account_kit(root, "pending-refused");
  await init_chatgpt(kit.deps);
  kit.fake.token_replies.push(oauth_error("invalid_grant"));
  await sign_in_with(kit);
  assert.equal(kit.stored().pending_client_id, "oaiapp_fake_1");
  kit.fake.token_replies.push(oauth_error("invalid_client", 401));
  assert.deepEqual((await sign_in_with(kit)).error, { code: "token_invalid", detail: "invalid_client" });
  assert.equal(new URL(kit.opened[1] ?? "").searchParams.get("client_id"), "oaiapp_fake_1");
  assert.equal(kit.stored().pending_client_id, null);
  kit.fake.issued_client_id = "oaiapp_fake_2";
  assert.equal((await sign_in_with(kit)).status, "signed_in");
  assert.equal(new URL(kit.opened[2] ?? "").searchParams.get("client_id"), registration_client_id);
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_2");
});

test("use another account ignores a pending client id and starts a registration", async () => {
  const kit = account_kit(root, "fresh-pending");
  await init_chatgpt(kit.deps);
  kit.fake.token_replies.push(oauth_error("invalid_grant"));
  await sign_in_with(kit);
  assert.equal(kit.stored().pending_client_id, "oaiapp_fake_1");
  kit.fake.issued_client_id = "oaiapp_fake_2";
  const account = await sign_in_with(kit, { fresh: true, consent: false });
  assert.equal(account.status, "signed_in");
  const params = new URL(kit.opened[1] ?? "").searchParams;
  assert.equal(params.get("client_id"), registration_client_id);
  assert.equal(params.get("agent_name_hint"), "VantheaX");
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_2");
  assert.equal(kit.stored().pending_client_id, null);
});

test("a sign-in that replaces another registration revokes its refresh token, one that renews the same registration does not", async () => {
  const kit = await signed_in_kit(root, "replaced");
  const old = kit.stored().account;
  await sign_in_with(kit, { fresh: false, consent: true });
  assert.equal(kit.fake.count(revocation_endpoint), 0);
  const renewed = kit.stored().account;
  assert.notEqual(renewed.tokens.refresh_token, old.tokens.refresh_token);
  kit.fake.account = { sub: "user-bob", email: "bob@example.com", name: "Bob" };
  kit.fake.issued_client_id = "oaiapp_fake_2";
  const account = await sign_in_with(kit, { fresh: true, consent: false });
  assert.equal(account.email, "bob@example.com");
  const revokes = kit.fake.forms(revocation_endpoint);
  assert.equal(revokes.length, 1);
  assert.equal(revokes[0]?.get("token"), renewed.tokens.refresh_token);
  assert.equal(revokes[0]?.get("client_id"), "oaiapp_fake_1");
  assert.equal(kit.stored().account.client_id, "oaiapp_fake_2");
  assert.equal(kit.stored().account.subject, "user-bob");
});

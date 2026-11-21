import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { token_endpoint } from "../electron/chatgpt/endpoints.ts";
import { access_token, account_models, chatgpt_account, init_chatgpt, renewed_token, settle_chatgpt, shutdown_chatgpt } from "../electron/chatgpt/service.ts";
import { ModelError } from "../electron/model/errors.ts";
import { account_kit, make_key, oauth_error, sign_in_with, signed_in_kit, temp_root, type AccountKit } from "./support/fake-openai-auth.ts";

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

const hour = 3600 * 1000;

const refreshes = (kit: AccountKit) => kit.fake.forms(token_endpoint).filter((form) => form.get("grant_type") === "refresh_token");

const plan_error = (kind: string, pattern: RegExp) => (error: unknown) => error instanceof ModelError && error.kind === kind && pattern.test(error.message);

const gate = (kit: AccountKit) => {
  let release: () => void = () => undefined;
  kit.fake.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    kit.fake.gate = null;
    release();
  };
};

test("before init and without a sign-in the token calls fail with plan_auth", async () => {
  shutdown_chatgpt();
  assert.equal(chatgpt_account().status, "signed_out");
  assert.equal(account_models(), null);
  await assert.rejects(access_token(), plan_error("plan_auth", /Not signed in to ChatGPT/));
  await assert.rejects(renewed_token("x"), plan_error("plan_auth", /Not signed in to ChatGPT/));
  const kit = account_kit(root, "signed-out");
  await init_chatgpt(kit.deps);
  await assert.rejects(access_token(), plan_error("plan_auth", /Settings > General/));
});

test("a valid access token is returned without a refresh", async () => {
  const kit = await signed_in_kit(root, "valid");
  const stored = kit.stored().account.tokens.access_token;
  kit.advance(hour - 1);
  assert.equal(await access_token(), stored);
  assert.equal(refreshes(kit).length, 0);
});

test("concurrent callers share one refresh whose rotation is stored before any caller continues", async () => {
  const kit = await signed_in_kit(root, "concurrent");
  const old = kit.stored().account.tokens;
  kit.advance(hour);
  const release = gate(kit);
  const stored_when_resolved: string[] = [];
  const callers = Array.from({ length: 5 }, () =>
    access_token().then((token) => {
      stored_when_resolved.push(kit.stored().account.tokens.refresh_token);
      return token;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes(kit).length, 1);
  release();
  const tokens = await Promise.all(callers);
  assert.equal(new Set(tokens).size, 1);
  assert.notEqual(tokens[0], old.access_token);
  assert.equal(refreshes(kit).length, 1);
  const form = refreshes(kit)[0];
  assert.deepEqual([...(form?.keys() ?? [])], ["grant_type", "client_id", "refresh_token", "resource"]);
  assert.equal(form?.get("refresh_token"), old.refresh_token);
  const renewed = kit.stored().account.tokens;
  assert.equal(stored_when_resolved.every((value) => value === renewed.refresh_token), true);
  assert.notEqual(renewed.refresh_token, old.refresh_token);
  assert.equal(renewed.access_token, tokens[0]);
  assert.equal(renewed.expires_at, 1_800_000_000_000 + 2 * hour);
  assert.deepEqual(renewed.scopes, old.scopes);
  assert.equal(renewed.id_token, old.id_token);
  assert.equal(await access_token(), tokens[0]);
  assert.equal(refreshes(kit).length, 1);
});

test("a caller that gives up does not cancel the refresh", async () => {
  const kit = await signed_in_kit(root, "abandoned");
  const old = kit.stored().account.tokens;
  kit.advance(hour);
  const release = gate(kit);
  const abort = new AbortController();
  const aborted = new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(new Error("caller aborted"))));
  const racing = Promise.race([access_token(), aborted]);
  abort.abort();
  await assert.rejects(racing, /caller aborted/);
  release();
  const token = await access_token();
  assert.equal(refreshes(kit).length, 1);
  assert.notEqual(kit.stored().account.tokens.refresh_token, old.refresh_token);
  assert.equal(kit.stored().account.tokens.access_token, token);
});

test("settle_chatgpt waits until a running renewal has stored its rotation, also when the service shuts down meanwhile", async () => {
  const kit = await signed_in_kit(root, "quit");
  const old = kit.stored().account.tokens;
  kit.advance(hour);
  const release = gate(kit);
  const caller = access_token();
  await new Promise((resolve) => setImmediate(resolve));
  let done = false;
  const settling = settle_chatgpt().then(() => {
    done = true;
  });
  shutdown_chatgpt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, false);
  release();
  await settling;
  assert.notEqual(kit.stored().account.tokens.refresh_token, old.refresh_token);
  assert.equal(kit.stored().account.tokens.access_token, await caller);
  await settle_chatgpt();
});

test("each terminal refresh code expires the sign-in and keeps identity and client id", async () => {
  for (const code of ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]) {
    const kit = await signed_in_kit(root, `terminal-${code}`);
    kit.advance(hour);
    kit.fake.token_replies.push(oauth_error(code));
    const models = kit.models_changed;
    await assert.rejects(access_token(), plan_error("plan_auth", /has expired/), code);
    assert.equal(chatgpt_account().status, "expired", code);
    assert.equal(chatgpt_account().email, "ada@example.com");
    const stored = kit.stored().account;
    assert.equal(stored.tokens, null);
    assert.equal(stored.expired, true);
    assert.equal(stored.client_id, "oaiapp_fake_1");
    assert.equal(stored.subject, "user-ada");
    assert.equal(kit.models_changed, models + 1);
    await assert.rejects(access_token(), plan_error("plan_auth", /Not signed in/));
  }
});

test("invalid_client and other client errors keep the tokens and name the code", async () => {
  const kit = await signed_in_kit(root, "client-error");
  const old = kit.vault.stored;
  kit.advance(hour);
  kit.fake.token_replies.push(oauth_error("invalid_client", 401), oauth_error("invalid_scope"));
  await assert.rejects(access_token(), plan_error("plan_auth", /invalid_client/));
  await assert.rejects(access_token(), plan_error("plan_auth", /invalid_scope/));
  assert.equal(kit.vault.stored, old);
  assert.equal(chatgpt_account().status, "signed_in");
});

test("a network failure or a server error keeps everything and reports provider_unavailable", async () => {
  const kit = await signed_in_kit(root, "network");
  const old = kit.vault.stored;
  kit.advance(hour);
  kit.fake.token_replies.push("network", { status: 503, body: "busy" });
  await assert.rejects(access_token(), plan_error("provider_unavailable", /could not be reached/));
  await assert.rejects(access_token(), (error: unknown) => error instanceof ModelError && error.kind === "provider_unavailable" && error.status === 503);
  assert.equal(kit.vault.stored, old);
  assert.equal(chatgpt_account().status, "signed_in");
  assert.notEqual(await access_token(), JSON.parse(old).account.tokens.access_token);
});

test("renewed_token returns a newer stored token, waits for earliest_refresh_at and otherwise refreshes", async () => {
  const kit = account_kit(root, "renewal");
  kit.fake.earliest_refresh_at = 1_800_000_000 + 600;
  await init_chatgpt(kit.deps);
  await sign_in_with(kit);
  const current = kit.stored().account.tokens.access_token;
  assert.equal(kit.stored().account.tokens.earliest_refresh_at, (1_800_000_000 + 600) * 1000);
  assert.equal(await renewed_token("an-older-token"), current);
  await assert.rejects(renewed_token(current), plan_error("plan_auth", /cannot be renewed yet/));
  assert.equal(refreshes(kit).length, 0);
  kit.advance(600 * 1000);
  kit.fake.earliest_refresh_at = "2027-01-15T08:00:00Z";
  const renewed = await renewed_token(current);
  assert.notEqual(renewed, current);
  assert.equal(refreshes(kit).length, 1);
  assert.equal(kit.stored().account.tokens.earliest_refresh_at, Date.parse("2027-01-15T08:00:00Z"));
  kit.fake.earliest_refresh_at = { at: 1 };
  kit.advance(hour);
  await access_token();
  assert.equal(kit.stored().account.tokens.earliest_refresh_at, null);
  const latest = kit.stored().account.tokens.access_token;
  assert.notEqual(await renewed_token(latest), latest);
});

test("a refresh replaces the scopes when the response has them and verifies a returned ID token", async () => {
  const kit = await signed_in_kit(root, "scopes");
  kit.advance(hour);
  kit.fake.refresh_scope = "openid profile email offline_access";
  const changes = kit.changes.length;
  await access_token();
  assert.deepEqual(kit.stored().account.tokens.scopes, ["openid", "profile", "email", "offline_access"]);
  assert.equal(chatgpt_account().plan_enabled, false);
  assert.equal(kit.changes.length, changes + 1);
  await assert.rejects(access_token(), plan_error("plan_auth", /does not allow plan usage/));
  const other = await signed_in_kit(root, "renewed-identity");
  other.advance(hour);
  other.fake.refresh_id_token = { ...other.fake.claims("oaiapp_fake_1", null), email: "ada@new.example.com" };
  await access_token();
  assert.equal(chatgpt_account().email, "ada@new.example.com");
  assert.equal(other.stored().account.tokens.id_token.split(".").length, 3);
  other.advance(hour);
  other.fake.refresh_id_token = { ...other.fake.claims("oaiapp_fake_1", null), sub: "user-eve" };
  await assert.rejects(access_token(), plan_error("plan_auth", /has expired/));
  assert.equal(chatgpt_account().status, "expired");
});

test("a renewed ID token whose signing keys cannot be fetched keeps the rotated tokens and the sign-in", async () => {
  const kit = await signed_in_kit(root, "keys-unreachable");
  kit.fake.signer = make_key("key-2");
  for (const failure of ["network", { status: 503, body: "busy" }] as const) {
    const old = kit.stored().account.tokens;
    kit.advance(hour);
    kit.fake.refresh_id_token = { ...kit.fake.claims("oaiapp_fake_1", null), email: "ada@new.example.com" };
    kit.fake.jwks_replies.push(failure);
    const token = await access_token();
    const renewed = kit.stored().account.tokens;
    assert.notEqual(renewed.refresh_token, old.refresh_token);
    assert.equal(renewed.access_token, token);
    assert.equal(renewed.id_token, old.id_token);
    assert.equal(chatgpt_account().status, "signed_in");
    assert.equal(chatgpt_account().email, "ada@example.com");
  }
  kit.advance(hour);
  kit.fake.refresh_id_token = { ...kit.fake.claims("oaiapp_fake_1", null), email: "ada@new.example.com" };
  kit.fake.jwks_keys.push(kit.fake.signer);
  await access_token();
  assert.equal(chatgpt_account().email, "ada@new.example.com");
});

test("an unreadable stored session is treated as signed out without logging its content", async () => {
  for (const [name, stored] of [
    ["broken-json", "{\"account\": tok-secret-value"],
    ["bad-field", JSON.stringify({ account: { issuer: "x", subject: "s", client_id: "c", email: null, name: null, expired: false, tokens: { access_token: 5 } }, pending_client_id: null })],
  ] as const) {
    const kit = account_kit(root, name);
    kit.vault.stored = stored;
    logged.length = 0;
    await init_chatgpt(kit.deps);
    assert.equal(chatgpt_account().status, "signed_out", name);
    assert.ok(logged.some((line) => line.includes("unreadable")), name);
    assert.equal(logged.some((line) => line.includes("tok-secret-value") || line.includes("\"issuer\"")), false, name);
  }
  const kit = account_kit(root, "decrypt-failure");
  kit.deps.secret.read = () => {
    throw new Error("decryption failed");
  };
  await init_chatgpt(kit.deps);
  assert.equal(chatgpt_account().status, "signed_out");
});

test("a corrupt state file is kept aside and replaced by a fresh one with a new host id", async () => {
  const kit = account_kit(root, "corrupt-plain");
  await fs.mkdir(path.dirname(kit.deps.file), { recursive: true });
  await fs.writeFile(kit.deps.file, "{ not json");
  await init_chatgpt(kit.deps);
  const files = await fs.readdir(path.dirname(kit.deps.file));
  assert.equal(files.some((file) => file.startsWith("chatgpt.json.corrupt-")), true);
  const fresh = JSON.parse(await fs.readFile(kit.deps.file, "utf8"));
  assert.equal(fresh.version, 1);
  assert.match(fresh.host_id, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(fresh.notice_seen, false);
  assert.equal(fresh.models, null);
});

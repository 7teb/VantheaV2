import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, before, test } from "node:test";
import { authorize_url, type AuthorizeRequest } from "../electron/chatgpt/authorize-url.ts";
import { api_resource, authorize_endpoint, registration_client_id, scope } from "../electron/chatgpt/endpoints.ts";
import { code_challenge, random_value } from "../electron/chatgpt/pkce.ts";
import { cancel_sign_in, init_chatgpt, shutdown_chatgpt, sign_out, start_sign_in } from "../electron/chatgpt/service.ts";
import { account_kit, oauth_error, sign_in_with, temp_root } from "./support/fake-openai-auth.ts";

let root = "";

before(async () => {
  root = await temp_root();
});

after(async () => {
  shutdown_chatgpt();
  await fs.rm(root, { recursive: true, force: true });
});

const base: AuthorizeRequest = {
  client_id: registration_client_id,
  host_id: "urn:uuid:4f1c2a9e-3b7d-4c8e-9a1f-2d3e4f5a6b7c",
  login_hint: null,
  redirect_uri: "http://127.0.0.1:49152/auth/callback",
  state: "state-value",
  nonce: "nonce-value",
  code_challenge: "challenge-value",
  consent: false,
};

const params_of = (url: string) => new URL(url).searchParams;

test("the first registration asks for the dynamic client with the agent name hint and every required parameter", () => {
  const url = authorize_url(base);
  assert.ok(url.startsWith(`${authorize_endpoint}?`));
  const params = params_of(url);
  assert.deepEqual([...params.keys()], [
    "client_id",
    "agent_name_hint",
    "ext_agent_host_id",
    "response_type",
    "redirect_uri",
    "scope",
    "resource",
    "state",
    "nonce",
    "code_challenge_method",
    "code_challenge",
  ]);
  assert.equal(params.get("client_id"), "dynamic_agent_client");
  assert.equal(params.get("agent_name_hint"), "VantheaX");
  assert.equal(params.get("ext_agent_host_id"), base.host_id);
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("redirect_uri"), base.redirect_uri);
  assert.equal(params.get("scope"), "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
  assert.equal(params.get("resource"), "https://api.openai.com/v1");
  assert.equal(params.get("state"), "state-value");
  assert.equal(params.get("nonce"), "nonce-value");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("code_challenge"), "challenge-value");
  assert.ok(url.includes("scope=openid%20profile%20email%20offline_access%20resource.invoke%20chatgpt.tokens.use.direct"));
  assert.ok(url.includes("redirect_uri=http%3A%2F%2F127.0.0.1%3A49152%2Fauth%2Fcallback"));
  assert.ok(url.includes("ext_agent_host_id=urn%3Auuid%3A"));
});

test("a returning account sends its issued client id and login hint without the agent name hint", () => {
  const params = params_of(authorize_url({ ...base, client_id: "oaiapp_123", login_hint: "ada@example.com" }));
  assert.equal(params.get("client_id"), "oaiapp_123");
  assert.equal(params.get("agent_name_hint"), null);
  assert.equal(params.get("login_hint"), "ada@example.com");
  assert.equal(params.get("scope"), scope);
  assert.equal(params.get("resource"), api_resource);
});

test("consent adds prompt=consent and nothing ever carries an ID token hint or forced re-consent", () => {
  const with_consent = authorize_url({ ...base, consent: true });
  assert.equal(params_of(with_consent).get("prompt"), "consent");
  assert.equal(params_of(authorize_url(base)).get("prompt"), null);
  for (const url of [with_consent, authorize_url({ ...base, client_id: "oaiapp_9", login_hint: "x@example.com", consent: true })]) {
    assert.equal(params_of(url).has("id_token_hint"), false);
    assert.equal(params_of(url).has("force_reconsent"), false);
  }
});

test("PKCE values are 32 random bytes in base64url and the challenge follows RFC 7636", () => {
  assert.equal(code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const values = new Set(Array.from({ length: 20 }, () => random_value()));
  assert.equal(values.size, 20);
  for (const value of values) {
    assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  }
});

test("the service picks the registration and returning client ids, never a pending id for another account, and fresh values per attempt", async () => {
  const kit = account_kit(root, "flows");
  await init_chatgpt(kit.deps);
  kit.browse = false;
  await start_sign_in({ fresh: false, consent: false });
  const first = params_of(kit.opened[0] ?? "");
  assert.equal(first.get("client_id"), registration_client_id);
  assert.equal(first.get("agent_name_hint"), "VantheaX");
  assert.equal(first.get("login_hint"), null);
  assert.match(first.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.match(first.get("ext_agent_host_id") ?? "", /^urn:uuid:[0-9a-f-]{36}$/);
  cancel_sign_in();
  kit.browse = true;
  const account = await sign_in_with(kit);
  assert.equal(account.status, "signed_in");
  const used = params_of(kit.opened[1] ?? "");
  assert.notEqual(used.get("state"), first.get("state"));
  assert.notEqual(used.get("nonce"), first.get("nonce"));
  assert.notEqual(used.get("code_challenge"), first.get("code_challenge"));
  assert.equal(used.get("ext_agent_host_id"), first.get("ext_agent_host_id"));
  await sign_out();
  kit.browse = false;
  await start_sign_in({ fresh: false, consent: true });
  const returning = params_of(kit.opened[2] ?? "");
  assert.equal(returning.get("client_id"), kit.fake.issued_client_id);
  assert.equal(returning.get("agent_name_hint"), null);
  assert.equal(returning.get("login_hint"), "ada@example.com");
  assert.equal(returning.get("prompt"), "consent");
  cancel_sign_in();
  await start_sign_in({ fresh: true, consent: false });
  const fresh = params_of(kit.opened[3] ?? "");
  assert.equal(fresh.get("client_id"), registration_client_id);
  assert.equal(fresh.get("login_hint"), null);
  cancel_sign_in();
  kit.fake.issued_client_id = "oaiapp_fake_2";
  kit.fake.token_replies.push(oauth_error("invalid_grant"));
  kit.browse = true;
  const failed = await sign_in_with(kit, { fresh: true, consent: false });
  assert.equal(failed.error?.code, "token_invalid");
  assert.equal(kit.stored().pending_client_id, "oaiapp_fake_2");
  kit.browse = false;
  await start_sign_in({ fresh: true, consent: false });
  const another = params_of(kit.opened[5] ?? "");
  assert.equal(another.get("client_id"), registration_client_id);
  assert.equal(another.get("agent_name_hint"), "VantheaX");
  assert.equal(another.get("login_hint"), null);
  cancel_sign_in();
  for (const url of kit.opened) {
    assert.equal(url.includes("id_token_hint"), false);
    assert.equal(url.includes("force_reconsent"), false);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { jwks_uri } from "../electron/chatgpt/endpoints.ts";
import { create_key_set, verify_id_token } from "../electron/chatgpt/id-token.ts";
import { fake_openai, make_key, sign_jwt } from "./support/fake-openai-auth.ts";

const now = 1_800_000_000_000;

const setup = () => {
  const fake = fake_openai(() => now);
  const keys = create_key_set(fake.fetch);
  const claims = (extra: Record<string, unknown> = {}) => ({ ...fake.claims("oaiapp_1", "nonce-1"), ...extra });
  const verify = (token: string, nonce: string | null = "nonce-1", at = now) => verify_id_token(token, { client_id: "oaiapp_1", nonce, now: at }, keys);
  return { fake, keys, claims, verify };
};

test("a valid ID token passes and yields subject, email and name", async () => {
  const { fake, claims, verify } = setup();
  assert.deepEqual(await verify(fake.id_token(claims())), { sub: "user-ada", email: "ada@example.com", name: "Ada" });
  assert.deepEqual(await verify(fake.id_token(claims({ aud: "oaiapp_1", azp: "oaiapp_1", email: undefined, name: "" }))), { sub: "user-ada", email: null, name: null });
  assert.deepEqual(await verify(fake.id_token(claims({ nonce: undefined })), null), { sub: "user-ada", email: "ada@example.com", name: "Ada" });
  assert.equal(fake.count(jwks_uri), 1);
});

test("signature, algorithm and claim failures are rejected", async () => {
  const { fake, claims, verify } = setup();
  const impostor = { ...make_key("key-1") };
  const cases: [string, string, RegExp][] = [
    ["bad signature", sign_jwt(impostor, claims()), /signature is invalid/],
    ["tampered payload", (() => {
      const [head, , signature] = fake.id_token(claims()).split(".");
      return `${head}.${Buffer.from(JSON.stringify(claims({ sub: "user-eve" }))).toString("base64url")}.${signature}`;
    })(), /signature is invalid/],
    ["wrong algorithm", fake.id_token(claims(), { alg: "HS256" }), /RS256/],
    ["no key id", fake.id_token(claims(), { kid: undefined }), /names no signing key/],
    ["wrong issuer", fake.id_token(claims({ iss: "https://auth.openai.com/" })), /wrong issuer/],
    ["wrong audience", fake.id_token(claims({ aud: ["oaiapp_2"] })), /another client/],
    ["expired", fake.id_token(claims({ exp: now / 1000 - 5 })), /expired/],
    ["no expiry", fake.id_token(claims({ exp: undefined })), /expired/],
    ["no issue time", fake.id_token(claims({ iat: undefined })), /issue time/],
    ["missing subject", fake.id_token(claims({ sub: undefined })), /no subject/],
    ["empty subject", fake.id_token(claims({ sub: "" })), /no subject/],
    ["wrong nonce", fake.id_token(claims({ nonce: "nonce-2" })), /another sign-in attempt/],
    ["missing nonce", fake.id_token(claims({ nonce: undefined })), /another sign-in attempt/],
    ["wrong authorized party", fake.id_token(claims({ azp: "oaiapp_2" })), /authorized for another client/],
    ["not a JWT", "abc.def", /not a signed JWT/],
  ];
  for (const [label, token, pattern] of cases) {
    await assert.rejects(verify(token), pattern, label);
  }
});

test("expiry allows five seconds of clock tolerance", async () => {
  const { fake, claims, verify } = setup();
  const token = fake.id_token(claims({ exp: now / 1000 }));
  assert.equal((await verify(token, "nonce-1", now + 4000)).sub, "user-ada");
  await assert.rejects(verify(token, "nonce-1", now + 5000), /expired/);
});

test("an unknown key id fetches the key set once more and fails when the key is still missing", async () => {
  const { fake, claims, verify } = setup();
  await verify(fake.id_token(claims()));
  assert.equal(fake.count(jwks_uri), 1);
  await verify(fake.id_token(claims()));
  assert.equal(fake.count(jwks_uri), 1);
  fake.signer = make_key("key-2");
  fake.jwks_keys.push(fake.signer);
  assert.equal((await verify(fake.id_token(claims()))).sub, "user-ada");
  assert.equal(fake.count(jwks_uri), 2);
  await assert.rejects(verify(fake.id_token(claims(), { kid: "key-ghost" })), /unknown key key-ghost/);
  assert.equal(fake.count(jwks_uri), 3);
  assert.equal(fake.requests.every((entry) => entry.redirect === "error" && entry.method === "GET"), true);
});

test("a key set without the signing key fails the verification", async () => {
  const { fake, claims, verify } = setup();
  const token = fake.id_token(claims());
  fake.jwks_keys.length = 0;
  await assert.rejects(verify(token), /unknown key key-1/);
});

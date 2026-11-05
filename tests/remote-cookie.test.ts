import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie_name, new_session_id, new_token, session_cookie, sign_session, token_matches, verify_session } from "../electron/remote/session-cookie.ts";

test("tokens are 32 random bytes and session ids 16, both base64url", () => {
  const token = new_token();
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(new_token(), token);
  assert.match(new_session_id(), /^[A-Za-z0-9_-]{22}$/);
});

test("a signed session verifies with the same token and returns its id", () => {
  const token = new_token();
  const session_id = new_session_id();
  const header = `other=1; ${cookie_name}=${sign_session(token, session_id)}; theme=dark`;
  assert.equal(verify_session(token, header), session_id);
});

test("a tampered id, signature or cookie name fails", () => {
  const token = new_token();
  const session_id = new_session_id();
  const signed = sign_session(token, session_id);
  const [id, signature] = signed.split(".");
  const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
  assert.equal(verify_session(token, `${cookie_name}=${id}.${flipped}`), null);
  assert.equal(verify_session(token, `${cookie_name}=${new_session_id()}.${signature}`), null);
  assert.equal(verify_session(token, `x${cookie_name}=${signed}`), null);
  assert.equal(verify_session(token, `${cookie_name}=${signature}`), null);
  assert.equal(verify_session(token, `${cookie_name}=.${signature}`), null);
  assert.equal(verify_session(token, ""), null);
  assert.equal(verify_session("", `${cookie_name}=${signed}`), null);
});

test("a renewed token invalidates every cookie signed with the old one", () => {
  const signed = sign_session(new_token(), new_session_id());
  assert.equal(verify_session(new_token(), `${cookie_name}=${signed}`), null);
});

test("the valid cookie wins when the browser sends a stale one first", () => {
  const token = new_token();
  const session_id = new_session_id();
  const stale = sign_session(new_token(), new_session_id());
  assert.equal(verify_session(token, `${cookie_name}=${stale}; ${cookie_name}=${sign_session(token, session_id)}`), session_id);
});

test("token comparison needs equal length and content", () => {
  const token = new_token();
  assert.equal(token_matches(token, token), true);
  assert.equal(token_matches(token, token.slice(0, -1)), false);
  assert.equal(token_matches(token, ""), false);
  assert.equal(token_matches("", ""), false);
  assert.equal(token_matches(token, new_token()), false);
});

test("the session cookie is HttpOnly, SameSite=Strict, Path=/ and kept for 400 days", () => {
  const value = session_cookie(new_token(), new_session_id());
  assert.match(value, new RegExp(`^${cookie_name}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+; `));
  for (const flag of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=34560000"]) {
    assert.ok(value.split("; ").includes(flag), flag);
  }
  assert.ok(!/Domain=/i.test(value));
});

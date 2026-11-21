import assert from "node:assert/strict";
import { test } from "node:test";
import { check_request } from "../electron/api/auth.ts";

const token = "t".repeat(40);

const expected = { token, port: 41000 };

const good = { host: "127.0.0.1:41000", authorization: `Bearer ${token}` };

test("a request with the right host and token passes", () => {
  assert.equal(check_request(good, expected), null);
  assert.equal(check_request({ ...good, host: "localhost:41000" }, expected), null);
  assert.equal(check_request({ ...good, host: "LOCALHOST:41000" }, expected), null);
  assert.equal(check_request({ ...good, authorization: `bearer  ${token} ` }, expected), null);
});

test("a host other than 127.0.0.1 or localhost on the bound port is refused with 421", () => {
  for (const host of ["127.0.0.1:41001", "127.0.0.1", "localhost", "evil.example:41000", "192.168.1.5:41000", "[::1]:41000", ""]) {
    assert.equal(check_request({ ...good, host }, expected)?.code, "bad_host", host);
    assert.equal(check_request({ ...good, host }, expected)?.status, 421);
  }
  assert.equal(check_request({ authorization: good.authorization }, expected)?.status, 421);
});

test("any Origin header is refused with 403", () => {
  for (const origin of ["http://127.0.0.1:41000", "null", "https://evil.example", ""]) {
    const refusal = check_request({ ...good, origin }, expected);
    assert.equal(refusal?.status, 403, origin);
    assert.equal(refusal?.code, "forbidden_origin");
  }
});

test("a missing, malformed or wrong token is refused with 401", () => {
  for (const authorization of [undefined, "", "Bearer", "Bearer ", `Basic ${token}`, `Bearer ${token}x`, `Bearer ${token.slice(1)}`, `Bearer x ${token}`, token]) {
    const refusal = check_request({ host: good.host, authorization }, expected);
    assert.equal(refusal?.status, 401, String(authorization));
    assert.equal(refusal?.code, "unauthorized");
  }
});

test("the host is checked before the origin and the origin before the token", () => {
  assert.equal(check_request({ host: "evil.example:41000", origin: "https://evil.example" }, expected)?.code, "bad_host");
  assert.equal(check_request({ host: good.host, origin: "https://evil.example" }, expected)?.code, "forbidden_origin");
  assert.equal(check_request({ host: good.host }, expected)?.code, "unauthorized");
});

test("the refusal message never repeats the expected token", () => {
  for (const headers of [{}, { host: good.host }, { host: good.host, origin: "x" }, { host: good.host, authorization: "Bearer wrong" }]) {
    assert.ok(!check_request(headers, expected)?.message.includes(token));
  }
});

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";
import { remote_refused } from "../shared/remote-policy.ts";
import { decode_wire, encode_wire, rpc_body_limit } from "../shared/remote-wire.ts";
import { kit, page, request, rpc, rpc_headers, start_kit, stop_kit } from "./remote-server-kit.ts";

before(() => start_kit(false));

after(stop_kit);

test("the server reports itself on, past an occupied port, with links that carry the pairing token", () => {
  const status = kit.vx.remote_status();
  assert.equal(status.state, "on");
  assert.ok(kit.port > kit.first_port, `port ${kit.port} should skip the occupied ${kit.first_port}`);
  assert.deepEqual(status.links, [
    {
      interface: "loopback",
      address: "127.0.0.1",
      url: `http://127.0.0.1:${kit.port}/`,
      pairing_url: `http://127.0.0.1:${kit.port}/pair?t=${kit.vx.current_token()}`,
    },
  ]);
  assert.equal(Buffer.from(kit.vx.current_token(), "base64url").length, 32);
});

test("the server listens only on the address it was given", async () => {
  const result = await new Promise<string>((resolve) => {
    const socket = net.connect({ host: "127.0.0.2", port: kit.port }, () => {
      socket.destroy();
      resolve("connected");
    });
    socket.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "error"));
  });
  assert.equal(result, "ECONNREFUSED");
});

test("nothing but pairing and the visual frame answers without a session cookie", async (t) => {
  t.mock.method(console, "warn", () => {});
  const home = await request({ target: "/" });
  assert.equal(home.status, 401);
  assert.match(home.body, /This device is not paired/);
  assert.match(String(home.headers["content-security-policy"]), /default-src 'none'/);
  const unpaired = await request({ method: "POST", target: "/rpc", headers: rpc_headers({ Cookie: "" }), body: encode_wire({ channel: "chats:search", args: ["x"] }) });
  assert.equal(unpaired.status, 401);
  assert.deepEqual(decode_wire(unpaired.body), { ok: false, error: "not paired" });
  assert.equal((await request({ target: `/events?client=${page}` })).status, 401);
  assert.equal((await request({ target: "/media/image/x.png" })).status, 401);
  assert.equal((await request({ target: "/assets/app-1.js" })).status, 401);
  assert.equal((await request({ target: "/visual-frame.html" })).status, 200);
  assert.equal((await request({ target: "/", headers: { Cookie: "vx_session=AAAAAAAAAAAAAAAAAAAAAA.AAAA" } })).status, 401);
  assert.equal(kit.calls.length, 0);
});

test("pairing with a wrong token is refused and the right one sets a strict HttpOnly cookie", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const wrong = await request({ target: "/pair?t=wrong" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers["set-cookie"], undefined);
  assert.match(String(warn.mock.calls[0].arguments[0]), /pairing with a wrong token from/);
  const right = await request({ target: `/pair?t=${kit.vx.current_token()}` });
  assert.equal(right.status, 303);
  assert.equal(right.headers.location, "/");
  assert.equal(right.headers["cache-control"], "no-store");
  const set_cookie = right.headers["set-cookie"]?.[0] ?? "";
  for (const flag of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=34560000"]) {
    assert.ok(set_cookie.split("; ").includes(flag), flag);
  }
  kit.cookie = set_cookie.split(";")[0];
  const home = await request({ target: "/", headers: { Cookie: kit.cookie } });
  assert.equal(home.status, 200);
  assert.equal(home.body, "<!doctype html><title>app</title>");
});

test("every response carries the security headers and no CORS grant", async () => {
  const home = await request({ target: "/", headers: { Cookie: kit.cookie } });
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  assert.equal(home.headers["referrer-policy"], "no-referrer");
  assert.equal(home.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(home.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(home.headers["content-security-policy"], "frame-ancestors 'self'");
  assert.equal(home.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(home.headers["cache-control"], "no-store");
  assert.equal(home.headers["access-control-allow-origin"], undefined);
  const asset = await request({ target: "/assets/app-1.js", headers: { Cookie: kit.cookie } });
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers["content-type"]), /^text\/javascript/);
  assert.equal(asset.headers["cache-control"], "private, max-age=31536000, immutable");
  const missing = await request({ target: "/nothing.js", headers: { Cookie: kit.cookie } });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers["x-content-type-options"], "nosniff");
});

test("a request for another Host is refused with 421, even with a valid cookie", async () => {
  for (const host of ["evil.example", `evil.example:${kit.port}`, `localhost:${kit.port}`, `127.0.0.1:${kit.port + 1}`]) {
    const reply = await request({ target: "/", host, headers: { Cookie: kit.cookie } });
    assert.equal(reply.status, 421, host);
    assert.equal(reply.body, "");
  }
  const without_host = await new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port: kit.port }, () => socket.end(`GET / HTTP/1.0\r\nCookie: ${kit.cookie}\r\n\r\n`));
    let text = "";
    socket.on("data", (chunk) => (text += chunk.toString("latin1")));
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
  assert.match(without_host, /^HTTP\/1\.1 421 /);
});

test("static and media paths cannot leave their roots", async (t) => {
  t.mock.method(console, "warn", () => {});
  const targets = [
    "/..%2Fsecret.txt",
    "/%2e%2e/secret.txt",
    "/assets/..%5C..%5Csecret.txt",
    "/assets%5C..%5C..%5Csecret.txt",
    "/index.html%00.js",
    "/notes.txt",
    "/C:%2FWindows%2Fwin.ini",
    "/%E0%A4%A",
    "/media/image/..%2F..%2Fsecret.txt",
    "/media/image/",
    "/media/unknown/x.png",
    "/media",
  ];
  for (const target of targets) {
    assert.equal((await request({ target, headers: { Cookie: kit.cookie } })).status, 404, target);
  }
});

test("rpc refuses a foreign or missing origin, a wrong content type and a missing client id", async (t) => {
  t.mock.method(console, "warn", () => {});
  const body = encode_wire({ channel: "chats:search", args: [] });
  const without = (name: string) => Object.fromEntries(Object.entries(rpc_headers()).filter(([key]) => key !== name));
  assert.equal((await rpc("chats:search", ["x"], { Origin: "http://evil.example" })).status, 403);
  assert.equal((await request({ method: "POST", target: "/rpc", headers: without("Origin"), body })).status, 403);
  assert.equal((await rpc("chats:search", ["x"], { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await rpc("chats:search", ["x"], { "X-VX-Client": "short" })).status, 400);
  assert.equal((await request({ method: "POST", target: "/rpc", headers: without("X-VX-Client"), body })).status, 400);
  assert.equal((await rpc("chats:search", ["x"], { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await request({ target: "/rpc", headers: { Cookie: kit.cookie } })).status, 405);
  assert.equal((await request({ method: "DELETE", target: "/", headers: { Cookie: kit.cookie } })).status, 405);
  assert.equal((await request({ target: `/events?client=${page}`, headers: { Cookie: kit.cookie, "Sec-Fetch-Site": "same-site" } })).status, 403);
  assert.equal(kit.calls.length, 0);
});

test("rpc rejects malformed bodies, unknown channels and oversized requests", async () => {
  const post = (body: string) => request({ method: "POST", target: "/rpc", headers: rpc_headers(), body });
  assert.equal((await post("{not json")).status, 400);
  assert.equal((await post(encode_wire({ channel: 1, args: [] }))).status, 400);
  assert.equal((await post(encode_wire({ channel: "chats:search", args: "x" }))).status, 400);
  assert.equal((await post(encode_wire({ channel: "chats:search", args: new Array(17).fill(0) }))).status, 400);
  assert.equal((await rpc("chats:nothing", [])).status, 404);
  assert.equal((await rpc("turn:event", [])).status, 404);
  assert.equal((await rpc("__proto__", [])).status, 404);
  const oversized = await new Promise<number>((resolve, reject) => {
    const headers = { Host: `127.0.0.1:${kit.port}`, ...rpc_headers(), "Content-Length": String(rpc_body_limit + 1) };
    const outgoing = http.request({ host: "127.0.0.1", port: kit.port, agent: false, method: "POST", path: "/rpc", headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.on("error", reject);
    outgoing.write("{");
  });
  assert.equal(oversized, 413);
  assert.equal(kit.calls.length, 0);
});

test("every PC-only channel is refused for a remote client and the window survives window:close", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  for (const channel of remote_refused) {
    const reply = await rpc(channel, []);
    assert.equal(reply.status, 403, channel);
    assert.deepEqual(decode_wire(reply.body), { ok: false, error: `${channel} is not available on a remote client` });
  }
  assert.equal(warn.mock.callCount(), remote_refused.size);
  assert.match(String(warn.mock.calls[0].arguments[0]), /^\[remote\] refused window:minimize from remote:/);
  assert.equal(kit.calls.filter((call) => call.channel === "window:close").length, 0);
});

test("rpc reaches the shared handlers as the remote client, with bytes and plain errors", async (t) => {
  t.mock.method(console, "error", () => {});
  const reply = await rpc("chats:search", ["needle"]);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["cache-control"], "no-store");
  const result = decode_wire(reply.body) as { ok: true; result: [{ client: string; query: string }] };
  assert.equal(result.ok, true);
  assert.match(result.result[0].client, new RegExp(`^remote:[A-Za-z0-9_-]{22}\\.${page}$`));
  assert.equal(result.result[0].query, "needle");
  const upload = await rpc("attachments:save", [{ name: "a.bin", mime: "application/octet-stream", bytes: new Uint8Array(1000).fill(7) }]);
  assert.deepEqual(decode_wire(upload.body), { ok: true, result: { bytes: true, size: 1000 } });
  const failed = await rpc("chats:get", ["x"]);
  assert.equal(failed.status, 500);
  assert.deepEqual(decode_wire(failed.body), { ok: false, error: "chat x not found" });
  const sent = await rpc("terminal:input", ["term-1", "ls"]);
  assert.deepEqual(decode_wire(sent.body), { ok: true });
  assert.deepEqual(kit.calls.at(-1), { channel: "terminal:input", client: result.result[0].client, args: ["term-1", "ls"] });
});

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { decode_wire, encode_wire } from "../shared/remote-wire.ts";
import { kit, pair_cookie, rpc, rpc_headers, settle, start_kit, stop_kit, type Reply } from "./remote-server-kit.ts";

before(() => start_kit(true));

after(stop_kit);

const signal = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const held_rpc = (channel: string, args: unknown[]) => {
  const body = Buffer.from(encode_wire({ channel, args }));
  let outgoing: http.ClientRequest | null = null;
  const reply = new Promise<Reply>((resolve, reject) => {
    outgoing = http.request(
      {
        host: "127.0.0.1",
        port: kit.port,
        agent: false,
        method: "POST",
        path: "/rpc",
        headers: { Host: `127.0.0.1:${kit.port}`, ...rpc_headers(), "Content-Length": String(body.length) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    outgoing.on("error", reject);
    outgoing.write(body.subarray(0, 5));
  });
  return { reply, finish: () => outgoing?.end(body.subarray(5)) };
};

test("a request whose body was still arriving when the link was renewed is not dispatched", async (t) => {
  t.mock.method(console, "warn", () => {});
  const calls = kit.calls.length;
  const held = held_rpc("terminal:input", ["term-1", "whoami"]);
  await settle(80);
  await kit.vx.renew_remote_link();
  held.finish();
  const reply = await held.reply;
  assert.equal(reply.status, 401);
  assert.deepEqual(decode_wire(reply.body), { ok: false, error: "not paired" });
  assert.equal(kit.calls.length, calls);
});

test("an invoke that was running when the link was renewed returns no result", async (t) => {
  t.mock.method(console, "warn", () => {});
  let entered = signal();
  let gate = signal();
  kit.vx.handle("chats:list", async () => {
    entered.resolve();
    await gate.promise;
    return [{ id: "chat-1" }];
  });
  kit.cookie = await pair_cookie(kit.vx.current_token());
  gate.resolve();
  const before_renewal = await rpc("chats:list", []);
  assert.equal(before_renewal.status, 200);
  assert.deepEqual(decode_wire(before_renewal.body), { ok: true, result: [{ id: "chat-1" }] });
  entered = signal();
  gate = signal();
  const pending = rpc("chats:list", []);
  await entered.promise;
  await kit.vx.renew_remote_link();
  gate.resolve();
  const reply = await pending;
  assert.equal(reply.status, 401);
  assert.deepEqual(decode_wire(reply.body), { ok: false, error: "not paired" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { attachment_limits, dictation_limit_bytes } from "../shared/ipc/media.ts";
import { decode_wire, encode_wire, rpc_body_limit } from "../shared/remote-wire.ts";

const round = (value: unknown) => decode_wire(encode_wire(value));

test("bytes survive the wire as Uint8Array, also inside nested objects and arrays", () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => (index * 7) % 256);
  const decoded = round({ channel: "attachments:save", args: [{ name: "a.png", bytes, model_source: new Uint8Array([1, 2, 3]) }] }) as {
    args: [{ bytes: Uint8Array; model_source: Uint8Array }];
  };
  assert.ok(decoded.args[0].bytes instanceof Uint8Array);
  assert.deepEqual([...decoded.args[0].bytes], [...bytes]);
  assert.deepEqual([...decoded.args[0].model_source], [1, 2, 3]);
  assert.deepEqual([...(round([new Uint8Array(0)]) as Uint8Array[])[0]], []);
});

test("a Node Buffer goes out as bytes and not as its toJSON shape", () => {
  const decoded = round({ data: Buffer.from("hello") }) as { data: Uint8Array };
  assert.ok(decoded.data instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(decoded.data), "hello");
});

test("keys starting with $ are escaped, so a payload cannot forge the bytes marker", () => {
  const value = { $b: "AAAA", $$x: 1, nested: [{ $b: "not bytes", plain: true }], text: "$b" };
  const wire = encode_wire(value);
  assert.ok(!wire.includes('{"$b":"AAAA"}'));
  assert.deepEqual(round(value), value);
  assert.deepEqual(decode_wire('{"$$b":"AAAA"}'), { $b: "AAAA" });
});

test("undefined fields drop like IPC and plain values pass unchanged", () => {
  assert.deepEqual(round({ a: 1, b: undefined, c: null, d: "x", e: [1, "two", false] }), { a: 1, c: null, d: "x", e: [1, "two", false] });
  assert.equal(encode_wire(undefined), "null");
  assert.equal(round("plain"), "plain");
});

test("decoding untrusted JSON never touches Object.prototype", () => {
  const decoded = decode_wire('{"$x":1,"__proto__":{"polluted":true}}') as Record<string, unknown>;
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.deepEqual(Object.keys(decoded).sort(), ["__proto__", "x"]);
});

test("the rpc body limit covers two images or one dictation clip in base64", () => {
  assert.ok(rpc_body_limit > (2 * attachment_limits.image_bytes * 4) / 3);
  assert.ok(rpc_body_limit > (dictation_limit_bytes * 4) / 3);
  assert.ok(rpc_body_limit < 80 * 1024 * 1024);
});

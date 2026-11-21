import assert from "node:assert/strict";
import { test } from "node:test";
import { create_ring, resume_point } from "../electron/remote/ring.ts";

const sized = (text: string) => (seq: number) => ({ value: `${seq}:${text}`, size: text.length });

test("push numbers entries from 1 and after replays only newer entries", () => {
  const ring = create_ring<string>(1000);
  assert.equal(ring.seq(), 0);
  assert.equal(ring.oldest(), 1);
  assert.deepEqual(ring.push(sized("a")), { seq: 1, value: "1:a" });
  ring.push(sized("b"));
  ring.push(sized("c"));
  assert.equal(ring.seq(), 3);
  assert.equal(ring.oldest(), 1);
  assert.deepEqual(ring.after(1), [{ seq: 2, value: "2:b" }, { seq: 3, value: "3:c" }]);
  assert.deepEqual(ring.after(3), []);
  assert.deepEqual(ring.after(0).map((entry) => entry.seq), [1, 2, 3]);
});

test("entries over the byte limit are evicted from the oldest side", () => {
  const ring = create_ring<string>(10);
  ring.push(sized("aaaa"));
  ring.push(sized("bbbb"));
  assert.equal(ring.oldest(), 1);
  ring.push(sized("cccc"));
  assert.equal(ring.oldest(), 2);
  assert.deepEqual(ring.after(0).map((entry) => entry.seq), [2, 3]);
  ring.push(sized("dddddddddddd"));
  assert.equal(ring.oldest(), 5);
  assert.deepEqual(ring.after(0), []);
});

test("a long run of evictions keeps seq, oldest and replay consistent", () => {
  const ring = create_ring<string>(100);
  for (let at = 0; at < 9000; at += 1) {
    ring.push(sized("xxxxxxxxxx"));
  }
  assert.equal(ring.seq(), 9000);
  assert.equal(ring.oldest(), 8991);
  assert.deepEqual(ring.after(8995).map((entry) => entry.seq), [8996, 8997, 8998, 8999, 9000]);
  assert.equal(ring.after(0).length, 10);
});

test("reset draws a new boot id and starts over", () => {
  const ring = create_ring<string>(1000);
  const first = ring.boot;
  assert.match(first, /^[0-9a-f]{12}$/);
  ring.push(sized("a"));
  ring.reset();
  assert.notEqual(ring.boot, first);
  assert.match(ring.boot, /^[0-9a-f]{12}$/);
  assert.equal(ring.seq(), 0);
  assert.equal(ring.oldest(), 1);
  assert.deepEqual(ring.after(0), []);
  assert.deepEqual(ring.push(sized("b")), { seq: 1, value: "1:b" });
});

test("resume_point replays a known id, starts fresh without one and asks for a resync otherwise", () => {
  const ring = create_ring<string>(10);
  ring.push(sized("aaaa"));
  ring.push(sized("bbbb"));
  ring.push(sized("cccc"));
  const boot = ring.boot;
  const at = (last: string) => resume_point(last, boot, ring.seq(), ring.oldest());
  assert.deepEqual(at(""), { kind: "fresh" });
  assert.deepEqual(at(`${boot}.3`), { kind: "replay", after: 3 });
  assert.deepEqual(at(`${boot}.1`), { kind: "replay", after: 1 });
  assert.deepEqual(at(`${boot}.0`), { kind: "resync" });
  assert.deepEqual(at(`${boot}.4`), { kind: "resync" });
  assert.deepEqual(at("abcdef.2"), { kind: "resync" });
  assert.deepEqual(at(`${boot}`), { kind: "resync" });
  assert.deepEqual(at(`${boot}.x`), { kind: "resync" });
  assert.deepEqual(resume_point(`${boot}.0`, boot, 0, 1), { kind: "replay", after: 0 });
});

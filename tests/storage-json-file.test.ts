import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { flush_pending_sync, read_json, sweep_tmp, write_file_atomic, write_file_atomic_sync, write_json, writes_settled } from "../electron/storage/json-file.ts";

let dir = "";

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-json-"));
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test("write_json writes atomically and leaves no temp files", async () => {
  const file = path.join(dir, "nested", "value.json");
  await write_json(file, { a: 1 });
  assert.deepEqual(await read_json(file), { status: "ok", value: { a: 1 } });
  assert.deepEqual(await fs.readdir(path.dirname(file)), ["value.json"]);
});

test("concurrent writes to one file are serialized and the last value wins", async () => {
  const file = path.join(dir, "counter.json");
  await Promise.all(Array.from({ length: 25 }, (_, index) => write_json(file, { index })));
  assert.deepEqual(await read_json(file), { status: "ok", value: { index: 24 } });
  assert.equal((await fs.readdir(dir)).filter((name) => name.endsWith(".tmp")).length, 0);
});

test("read_json strips a UTF-8 BOM and reports missing and corrupt files", async () => {
  const bom_file = path.join(dir, "bom.json");
  await fs.writeFile(bom_file, "﻿{\"language\":\"de\"}", "utf8");
  assert.deepEqual(await read_json(bom_file), { status: "ok", value: { language: "de" } });
  assert.deepEqual(await read_json(path.join(dir, "absent.json")), { status: "missing" });
  const broken = path.join(dir, "broken.json");
  await fs.writeFile(broken, "{\"half\":", "utf8");
  assert.equal((await read_json(broken)).status, "corrupt");
});

test("a sync write supersedes a queued async write", async () => {
  const file = path.join(dir, "quit.json");
  const queued = write_json(file, { from: "async" });
  write_file_atomic_sync(file, JSON.stringify({ from: "sync" }));
  await queued;
  assert.deepEqual(await read_json(file), { status: "ok", value: { from: "sync" } });
});

test("a sync write wins over an async write that is still retrying its rename", async () => {
  const file = path.join(dir, "retry.json");
  await fs.mkdir(file);
  const retrying = write_json(file, { from: "async" });
  const temp_files = async () => (await fs.readdir(dir)).filter((name) => name.startsWith("retry.json.") && name.endsWith(".tmp"));
  for (let attempt = 0; attempt < 200 && (await temp_files()).length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  await fs.rmdir(file);
  write_file_atomic_sync(file, JSON.stringify({ from: "sync" }));
  await retrying;
  assert.deepEqual(await read_json(file), { status: "ok", value: { from: "sync" } });
  assert.deepEqual(await temp_files(), []);
});

test("writes_settled waits until a superseded write has removed its temp file", async () => {
  const file = path.join(dir, "settled.json");
  const superseded = write_json(file, { from: "async" });
  write_file_atomic_sync(file, JSON.stringify({ from: "sync" }));
  await writes_settled(file);
  assert.deepEqual(await read_json(file), { status: "ok", value: { from: "sync" } });
  assert.equal((await fs.readdir(dir)).some((name) => name.startsWith("settled.json.") && name.endsWith(".tmp")), false);
  await superseded;
  await writes_settled(path.join(dir, "never-written.json"));
});

test("flush_pending_sync writes queued data before an async drain finishes", async () => {
  const file = path.join(dir, "pending.json");
  const first = write_json(file, { step: 1 });
  const second = write_json(file, { step: 2 });
  flush_pending_sync();
  await Promise.all([first, second]);
  assert.deepEqual(await read_json(file), { status: "ok", value: { step: 2 } });
});

test("flush_pending_sync also lands a write that is still in flight", async () => {
  const file = path.join(dir, "in-flight.json");
  const running = write_json(file, { landed: true });
  flush_pending_sync();
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { landed: true });
  await running;
});

test("binary data round-trips and stale temp files are swept", async () => {
  const file = path.join(dir, "blob.bin");
  await write_file_atomic(file, new Uint8Array([1, 2, 3, 0, 255]));
  assert.deepEqual([...(await fs.readFile(file))], [1, 2, 3, 0, 255]);
  await fs.writeFile(path.join(dir, "settings.json.4242.deadbeef.tmp"), "partial");
  assert.equal(await sweep_tmp([dir, path.join(dir, "does-not-exist")]), 1);
  assert.equal((await fs.readdir(dir)).some((name) => name.endsWith(".tmp")), false);
});

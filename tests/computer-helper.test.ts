import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { ComputerHelper } from "../electron/computer/helper.ts";

const child = () => {
  const process = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 12345 });
  process.stdin.on("finish", () => process.emit("exit", 0));
  return process;
};

test("helper frames partial lines, uses matching IDs and reuses one child", async () => {
  const process = child();
  let starts = 0;
  const helper = new ComputerHelper(() => { starts++; setImmediate(() => process.stdout.write('{"ready":true}\n')); return process as unknown as ChildProcess; }, () => {});
  process.stdin.on("data", (line) => {
    const request = JSON.parse(String(line));
    if (request.op === "quit") return;
    const reply = JSON.stringify({ id: request.id, ok: true, value: { op: request.op } });
    process.stdout.write(reply.slice(0, 8));
    process.stdout.write(reply.slice(8) + "\n");
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await helper.request({ op: "displays" }, signal), { op: "displays" });
  assert.deepEqual(await helper.request({ op: "screenshot" }, signal), { op: "screenshot" });
  assert.equal(starts, 1);
  helper.close();
});

test("cancellation waits for the helper response, does not replay input and rejects overlapping calls", async () => {
  const process = child();
  const helper = new ComputerHelper(() => { setImmediate(() => process.stdout.write('{"ready":true}\n')); return process as unknown as ChildProcess; }, () => {});
  const abort = new AbortController();
  let id = 0;
  const ops: string[] = [];
  process.stdin.on("data", (line) => {
    const request = JSON.parse(String(line));
    ops.push(request.op);
    if (request.id) id = request.id;
    if (request.op === "cancel") process.stdout.write(JSON.stringify({ id, ok: false, error: "cancelled after releasing buttons" }) + "\n");
  });
  const action = helper.request({ op: "drag" }, abort.signal);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(helper.request({ op: "click" }, new AbortController().signal), /already running/);
  abort.abort();
  await assert.rejects(action, /cancelled/);
  assert.deepEqual(ops, ["drag", "cancel"]);
  helper.close();
});

test("closing during startup rejects the waiting call immediately", async () => {
  const process = child();
  const helper = new ComputerHelper(() => process as unknown as ChildProcess, () => {});
  const waiting = helper.request({ op: "displays" }, new AbortController().signal);
  helper.close();
  await assert.rejects(waiting, /closed during startup/);
});

test("Stop interrupts startup before a helper is ready", async () => {
  const process = child();
  const helper = new ComputerHelper(() => process as unknown as ChildProcess, () => {});
  const abort = new AbortController();
  const waiting = helper.request({ op: "displays" }, abort.signal);
  abort.abort();
  await assert.rejects(waiting, /closed during startup/);
});

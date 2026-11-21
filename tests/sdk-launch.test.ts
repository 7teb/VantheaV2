import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { create_vantheax, launch_args, parse_ready_line } from "../sdk/launch.ts";

const fake = fileURLToPath(new URL("./support/fake-headless.mjs", import.meta.url));

test("parse_ready_line accepts only the ready JSON line", () => {
  assert.deepEqual(parse_ready_line('{"vantheax":"ready","api":1,"url":"http://127.0.0.1:5000","pid":42}'), { url: "http://127.0.0.1:5000", api: 1, pid: 42 });
  assert.equal(parse_ready_line("[boot] starting"), null);
  assert.equal(parse_ready_line("{ broken"), null);
  assert.equal(parse_ready_line('{"vantheax":"error","step":"x","message":"y"}'), null);
  assert.equal(parse_ready_line('{"vantheax":"ready","api":1,"pid":42}'), null);
  for (const url of ["http://198.51.100.7:5000", "http://localhost:5000", "https://127.0.0.1:5000", "http://127.0.0.1:5000/x", "http://127.0.0.1.evil:5000"]) {
    assert.equal(parse_ready_line(JSON.stringify({ vantheax: "ready", api: 1, url, pid: 42 })), null, url);
  }
});

test("create_vantheax skips a ready line that names another host and connects to the loopback one", async () => {
  const vx = await create_vantheax({ exe_path: process.execPath, args: [fake, "--fake-foreign-ready"] });
  try {
    assert.match(vx.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await vx.client.info()).name, "VantheaX");
  } finally {
    await vx.close();
  }
});

test("create_vantheax rejects on exit when the only ready line names another host", async () => {
  await assert.rejects(create_vantheax({ exe_path: process.execPath, args: [fake, "--fake-foreign-ready", "--fake-fail"] }), /exited with 1 before it was ready/);
});

test("launch_args prepends the given args and adds the headless switches", () => {
  assert.deepEqual(launch_args({}), ["--vx-serve", "--vx-port=0", "--vx-lease=stdin"]);
  assert.deepEqual(launch_args({ args: ["main.js"], port: 4100, data_dir: "D:/vx data" }), [
    "main.js",
    "--vx-serve",
    "--vx-port=4100",
    "--vx-lease=stdin",
    "--vx-data-dir=D:/vx data",
  ]);
});

test("create_vantheax waits for the ready line, passes token and key, and close ends the lease", async () => {
  const data_dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-headless-launch-"));
  try {
    const vx = await create_vantheax({ exe_path: process.execPath, args: [fake], data_dir, openrouter_key: "or-test-key" });
    try {
      assert.match(vx.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const info = await vx.client.info();
      assert.equal(info.name, "VantheaX");
      assert.equal(info.headless, true);
      const launch = (await (await fetch(`${vx.url}/fake/launch`)).json()) as { argv: string[]; token_length: number; openrouter_key: string | null };
      assert.deepEqual(launch.argv, ["--vx-serve", "--vx-port=0", "--vx-lease=stdin", `--vx-data-dir=${data_dir}`]);
      assert.equal(launch.token_length, 64);
      assert.equal(launch.openrouter_key, "or-test-key");
      const unauthorized = await fetch(`${vx.url}/v1/info`);
      assert.equal(unauthorized.status, 401);
      await unauthorized.body?.cancel();
    } finally {
      await vx.close();
    }
    await assert.rejects(fetch(`${vx.url}/v1/info`));
    await vx.close();
  } finally {
    await fs.rm(data_dir, { recursive: true, force: true });
  }
});

test("create_vantheax rejects with the exit code and stderr when the child exits before ready", async () => {
  await assert.rejects(create_vantheax({ exe_path: process.execPath, args: [fake, "--fake-fail"] }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /exited with 1 before it was ready/);
    assert.match(error.message, /fake startup failure/);
    return true;
  });
});

test("create_vantheax rejects a server that speaks another API version", async () => {
  await assert.rejects(create_vantheax({ exe_path: process.execPath, args: [fake, "--fake-api=2"] }), /speaks API 2, this SDK speaks API 1/);
});

test("create_vantheax needs an executable from the option or VANTHEAX_EXE", async () => {
  const saved = process.env.VANTHEAX_EXE;
  delete process.env.VANTHEAX_EXE;
  try {
    await assert.rejects(create_vantheax({}), /pass exe_path or set VANTHEAX_EXE/);
  } finally {
    if (saved !== undefined) {
      process.env.VANTHEAX_EXE = saved;
    }
  }
});

test("create_vantheax reports a missing executable", async () => {
  await assert.rejects(create_vantheax({ exe_path: path.join(os.tmpdir(), "vx-tmp-headless-missing", "VantheaX.exe") }), /could not be started/);
});

test("aborting before ready rejects with the abort reason", async () => {
  const controller = new AbortController();
  const launching = create_vantheax({ exe_path: process.execPath, args: [fake], signal: controller.signal });
  controller.abort(new Error("launch cancelled"));
  await assert.rejects(launching, /launch cancelled/);
});

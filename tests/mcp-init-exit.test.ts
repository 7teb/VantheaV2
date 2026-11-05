import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { sync_servers, server_runtime } from "../electron/mcp/client.ts";

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
};

test("a server exiting during initialize leaves no detached process behind", { skip: process.platform !== "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-mcp-exit-"));
  const pid_file = path.join(root, "pids.json");
  const server_file = path.join(root, "server.mjs");
  const source = `import fs from 'node:fs';import {spawn} from 'node:child_process';import readline from 'node:readline';const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore',windowsHide:true,detached:true});await new Promise(resolve=>child.once('spawn',resolve));fs.writeFileSync(${JSON.stringify(pid_file)},JSON.stringify([process.pid,child.pid]));readline.createInterface({input:process.stdin}).on('line',()=>process.exit(1));`;
  let pids: number[] = [];
  try {
    await fs.writeFile(server_file, source);
    await sync_servers({ "review-exit": { command: process.execPath, args: [server_file], cwd: root, env: {}, enabled: true } });
    pids = JSON.parse(await fs.readFile(pid_file, "utf8"));
    assert.equal(server_runtime("review-exit")?.state, "error");
    const deadline = Date.now() + 1500;
    while (pids.some(alive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(pids.map(alive), [false, false]);
  } finally {
    if (!pids.length) pids = JSON.parse(await fs.readFile(pid_file, "utf8"));
    for (const pid of pids) if (alive(pid)) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await sync_servers({});
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { collect_changes, max_change_paths, watch_tree, type TreeChange } from "../electron/project/watch.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-watch-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, "node_modules"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a burst of events becomes one change with normalized, deduplicated paths", async () => {
  const flushed: TreeChange[] = [];
  const collector = collect_changes((change) => flushed.push(change), { delay_ms: 30, max_wait_ms: 500 });
  collector.add("src\\main.ts");
  collector.add("src/main.ts");
  collector.add("src\\util\\");
  await sleep(10);
  assert.deepEqual(flushed, []);
  await sleep(60);
  assert.deepEqual(flushed, [{ paths: ["src/main.ts", "src/util"], overflow: false }]);
  collector.close();
});

test("events under ignored folders never reach the renderer", async () => {
  const flushed: TreeChange[] = [];
  const collector = collect_changes((change) => flushed.push(change), { delay_ms: 20, max_wait_ms: 200 });
  collector.add("node_modules\\pkg\\index.js");
  collector.add(".git/index.lock");
  collector.add("packages/app/dist/out.js");
  await sleep(60);
  assert.deepEqual(flushed, []);
  collector.add("packages/app/src/out.ts");
  await sleep(60);
  assert.deepEqual(flushed, [{ paths: ["packages/app/src/out.ts"], overflow: false }]);
  collector.close();
});

test("an unnamed event or too many paths turn into an overflow", async () => {
  const flushed: TreeChange[] = [];
  const collector = collect_changes((change) => flushed.push(change), { delay_ms: 20, max_wait_ms: 200 });
  collector.add(null);
  collector.add("a.txt");
  await sleep(60);
  for (let index = 0; index <= max_change_paths; index += 1) {
    collector.add(`file${index}.txt`);
  }
  await sleep(60);
  assert.deepEqual(flushed, [
    { paths: [], overflow: true },
    { paths: [], overflow: true },
  ]);
  collector.close();
});

test("a steady stream still flushes after the maximum wait", async () => {
  const flushed: TreeChange[] = [];
  const collector = collect_changes((change) => flushed.push(change), { delay_ms: 40, max_wait_ms: 100 });
  const started = Date.now();
  while (Date.now() - started < 220) {
    collector.add("log.txt");
    await sleep(10);
  }
  assert.ok(flushed.length >= 1, `expected a flush during the stream, got ${flushed.length}`);
  collector.close();
});

test("closing drops pending changes", async () => {
  const flushed: TreeChange[] = [];
  const collector = collect_changes((change) => flushed.push(change), { delay_ms: 20, max_wait_ms: 200 });
  collector.add("a.txt");
  collector.close();
  await sleep(60);
  assert.deepEqual(flushed, []);
});

test("the tree watcher reports file changes on disk until it is closed", async () => {
  const flushed: TreeChange[] = [];
  const watcher = watch_tree(root, (change) => flushed.push(change), { delay_ms: 50, max_wait_ms: 400 });
  try {
    await sleep(50);
    await fs.writeFile(path.join(root, "src", "created.ts"), "export {};\n");
    await fs.writeFile(path.join(root, "node_modules", "ignored.js"), "");
    for (let waited = 0; waited < 3000 && flushed.length === 0; waited += 50) {
      await sleep(50);
    }
    const paths = flushed.flatMap((change) => change.paths);
    assert.ok(paths.includes("src/created.ts"), JSON.stringify(flushed));
    assert.ok(!paths.some((entry) => entry.startsWith("node_modules")), JSON.stringify(flushed));
  } finally {
    watcher.close();
  }
  const count = flushed.length;
  await fs.writeFile(path.join(root, "after-close.ts"), "");
  await sleep(200);
  assert.equal(flushed.length, count);
});

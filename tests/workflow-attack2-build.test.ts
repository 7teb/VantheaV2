import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const scripts_dir = path.join(import.meta.dirname, "..", "scripts");

const entry_points = (text: string): string[] => [...text.matchAll(/entryPoints:\s*\[\s*"([^"]+)"/g)].map((match) => match[1] ?? "");

test("npm run dev builds every main-process entry that npm run build builds, the workflow sandbox worker included", async () => {
  const build = entry_points(await fs.readFile(path.join(scripts_dir, "build-main.mjs"), "utf8"));
  const dev = entry_points(await fs.readFile(path.join(scripts_dir, "dev.mjs"), "utf8"));
  assert.ok(build.includes("electron/workflows/sandbox-worker.ts"), `build entries: ${build.join(", ")}`);
  assert.deepEqual(
    build.filter((entry) => !dev.includes(entry)),
    [],
    "the app loads dist-electron/workflow-sandbox.cjs at run time, so a dev session without it fails every workflow or runs a stale sandbox",
  );
});

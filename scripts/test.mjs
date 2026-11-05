import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const run_temp = mkdtempSync(path.join(os.tmpdir(), "vx-test-"));

const child = spawn(process.execPath, ["--test", "tests/**/*.test.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, TEMP: run_temp, TMP: run_temp, TMPDIR: run_temp },
});

const ignore_signal = () => {};
process.on("SIGINT", ignore_signal);
process.on("SIGTERM", ignore_signal);

child.on("exit", (code, signal) => {
  try {
    rmSync(run_temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`[test] could not remove ${run_temp}: ${error.message}`);
  }
  process.exit(code ?? (signal ? 1 : 0));
});

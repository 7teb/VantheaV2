import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { context } from "esbuild";
import { createServer } from "vite";
import electron_path from "electron";

const require_shim = 'import { createRequire as vx_create_require } from "node:module"; const require = vx_create_require(import.meta.url);';

const main_context = await context({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.js",
  format: "esm",
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron", "node-pty", "@modelcontextprotocol/sdk", "@vscode/ripgrep", "@anthropic-ai/claude-agent-sdk"],
  banner: { js: require_shim },
  logLevel: "info",
});

const sandbox_context = await context({
  entryPoints: ["electron/workflows/sandbox-worker.ts"],
  outfile: "dist-electron/workflow-sandbox.cjs",
  format: "cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  logLevel: "info",
});

const preload_context = await context({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  format: "cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron"],
  logLevel: "info",
});

const contexts = [main_context, sandbox_context, preload_context];

const rebuild_all = () => Promise.all(contexts.map((entry) => entry.rebuild()));

await rebuild_all();

const vite = await createServer({ configFile: "vite.config.ts" });
await vite.listen();
const url = vite.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:5173/";

let app = null;
let stopping = false;
let restart_timer = null;

const launch = () => {
  app = spawn(electron_path, ["."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  app.on("exit", () => {
    app = null;
    if (!stopping && !restart_timer) {
      shutdown();
    }
  });
};

const restart = () => {
  clearTimeout(restart_timer);
  restart_timer = setTimeout(async () => {
    try {
      await rebuild_all();
    } catch (error) {
      console.error("[dev] main rebuild failed:", error.message);
      restart_timer = null;
      return;
    }
    const previous = app;
    if (previous) {
      previous.removeAllListeners("exit");
      previous.once("exit", () => {
        restart_timer = null;
        launch();
      });
      previous.kill();
      return;
    }
    restart_timer = null;
    launch();
  }, 200);
};

const shutdown = async () => {
  if (stopping) {
    return;
  }
  stopping = true;
  app?.kill();
  await Promise.all(contexts.map((entry) => entry.dispose()));
  await vite.close();
  process.exit(0);
};

watch("electron", { recursive: true }, restart);
watch("shared", { recursive: true }, restart);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
launch();

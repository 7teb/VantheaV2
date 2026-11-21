import { app, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { api_version } from "../../shared/api/contract.ts";
import { settle_chatgpt } from "../chatgpt/service.ts";
import { register_ipc } from "../ipc/index.ts";
import { set_key_source } from "../model/key.ts";
import { error_text } from "../storage/coerce.ts";
import type { HeadlessConfig } from "./headless-args.ts";
import { init_services, shutdown_services } from "./lifecycle.ts";
import { set_guarded_roots, set_headless } from "./runtime.ts";

export type ApiServer = { url: string; close: () => Promise<void> };

const exit_with = (code: number, step: string, message: string) => {
  process.stderr.write(`${JSON.stringify({ vantheax: "error", step, message })}\n`, () => app.exit(code));
};

const redirect_path = (name: "userData" | "documents", dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  app.setPath(name, dir);
};

const stay_running = (): void => {};

const hold_stdin_lease = () => {
  const release = () => app.quit();
  const lease = fs.createReadStream("", { fd: 0, autoClose: false });
  lease.on("end", release);
  lease.on("close", release);
  lease.on("error", (error) => console.error("[headless] reading the stdin lease on fd 0 failed:", error));
  lease.resume();
};

export const run_headless = (config: HeadlessConfig, serve: (config: HeadlessConfig) => Promise<ApiServer>): void => {
  set_headless();
  set_guarded_roots([config.data_dir, config.app_dir]);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.VANTHEAX_API_TOKEN;
  process.on("uncaughtException", (error, origin) => {
    console.error(`[headless] ${origin} reached the top level, quitting:`, error);
    exit_with(1, origin, error_text(error));
  });
  try {
    redirect_path("userData", path.join(config.data_dir, "chromium"));
    redirect_path("documents", path.join(config.data_dir, "documents"));
  } catch (error) {
    console.error(`[headless] preparing the data dir ${config.data_dir} failed:`, error);
    exit_with(1, "data dir", error_text(error));
    return;
  }
  if (!app.requestSingleInstanceLock()) {
    exit_with(3, "lock", `another VantheaX process already uses the data dir ${config.data_dir}`);
    return;
  }
  let server: ApiServer | null = null;
  let services_started = false;
  let step = "ready";
  app.on("window-all-closed", stay_running);
  let quitting = false;
  let quit_ready = false;
  app.on("before-quit", (event) => {
    if (quit_ready) {
      return;
    }
    event.preventDefault();
    if (quitting) {
      return;
    }
    quitting = true;
    const renewal = settle_chatgpt();
    shutdown_services();
    const open = server;
    const closed = (open ? open.close() : Promise.resolve()).catch((error: unknown) => console.error(`[headless] closing the local API server at ${open?.url} failed:`, error));
    Promise.all([renewal, closed])
      .finally(() => {
        quit_ready = true;
        app.quit();
      });
  });
  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
  const start = async () => {
    Menu.setApplicationMenu(null);
    step = "services";
    await init_services({ storage_root: path.join(config.data_dir, "data") });
    services_started = true;
    step = "ipc";
    register_ipc();
    set_key_source(() => config.openrouter_key);
    step = "api";
    server = await serve(config);
    process.stdout.write(`${JSON.stringify({ vantheax: "ready", api: api_version, url: server.url, pid: process.pid })}\n`);
    if (config.lease_stdin) {
      hold_stdin_lease();
    }
  };
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error(`[headless] startup step "${step}" failed:`, error);
      if (services_started) {
        try {
          shutdown_services();
        } catch (shutdown_error) {
          console.error("[headless] shutting the started services down after the failed startup failed:", shutdown_error);
        }
      }
      exit_with(1, step, error_text(error));
    });
};

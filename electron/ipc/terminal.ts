import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import type { TerminalCreate } from "../../shared/ipc/panels.ts";
import { main_window } from "../app/window.ts";
import { spawn_shell } from "../terminal/pty.ts";
import { create_terminal_registry } from "../terminal/sessions.ts";
import { emit, handle, listen } from "./handle.ts";

const terminals = create_terminal_registry(
  spawn_shell,
  {
    data: (terminal_id, data) => emit("terminal:data", { terminal_id, data }),
    exit: (terminal_id, exit_code) => emit("terminal:exit", { terminal_id, exit_code }),
  },
  () => randomUUID(),
);

export const kill_all_terminals = () => terminals.close_all();

let watched: WebContents | null = null;

const watch_renderer = () => {
  const contents = main_window()?.webContents;
  if (!contents || contents === watched) {
    return;
  }
  watched = contents;
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      kill_all_terminals();
    }
  });
  contents.on("destroyed", kill_all_terminals);
};

const require_text = (value: unknown, field: string) => {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
};

const require_size = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
};

const terminal_cwd = async (value: unknown) => {
  const cwd = require_text(value, "cwd").trim();
  if (cwd === "") {
    return os.homedir();
  }
  const stat = await fs.stat(cwd).catch((error: unknown) => {
    throw new Error(`terminal cwd ${cwd} is not accessible: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!stat.isDirectory()) {
    throw new Error(`terminal cwd ${cwd} is not a directory`);
  }
  return cwd;
};

const create_terminal = async (request: TerminalCreate) => {
  if (!request || typeof request !== "object") {
    throw new Error("terminal request must be an object");
  }
  const cwd = await terminal_cwd(request.cwd);
  watch_renderer();
  return terminals.create({ cwd, cols: require_size(request.cols, "cols"), rows: require_size(request.rows, "rows") });
};

export const register_terminal_ipc = () => {
  handle("terminal:create", create_terminal);
  listen("terminal:input", (terminal_id, data) => terminals.input(require_text(terminal_id, "terminal_id"), require_text(data, "data")));
  listen("terminal:resize", (terminal_id, cols, rows) =>
    terminals.resize(require_text(terminal_id, "terminal_id"), require_size(cols, "cols"), require_size(rows, "rows")),
  );
  listen("terminal:close", (terminal_id) => terminals.close(require_text(terminal_id, "terminal_id")));
};

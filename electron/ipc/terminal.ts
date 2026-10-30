import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import type { FilesScope } from "../../shared/ipc/files.ts";
import type { TerminalCreate } from "../../shared/ipc/panels.ts";
import { main_window } from "../app/window.ts";
import { chat_meta } from "../chats/store.ts";
import { worktree_missing } from "../chats/workspace.ts";
import { files_root, parse_scope } from "../project/files-root.ts";
import { spawn_shell } from "../terminal/pty.ts";
import { create_terminal_registry } from "../terminal/sessions.ts";
import { on_client_gone, window_client, type ClientId } from "./clients.ts";
import { emit_to, handle, handle_client, listen_client } from "./handle.ts";

const owners = new Map<string, ClientId>();

const owner_of = (terminal_id: string): ClientId => owners.get(terminal_id) ?? window_client;

const terminals = create_terminal_registry(
  spawn_shell,
  {
    data: (terminal_id, data) => emit_to(owner_of(terminal_id), "terminal:data", { terminal_id, data }),
    exit: (terminal_id, exit_code) => {
      emit_to(owner_of(terminal_id), "terminal:exit", { terminal_id, exit_code });
      owners.delete(terminal_id);
    },
  },
  () => randomUUID(),
);

const prune_owners = () => {
  const live = new Set(terminals.ids());
  for (const terminal_id of [...owners.keys()]) {
    if (!live.has(terminal_id)) {
      owners.delete(terminal_id);
    }
  }
};

export const kill_all_terminals = () => {
  terminals.close_all();
  owners.clear();
};

export const close_chat_terminals = (chat_id: string) => {
  terminals.close_owner(chat_id);
  prune_owners();
};

export const close_client_terminals = (client: ClientId) => {
  for (const [terminal_id, owner] of [...owners]) {
    if (owner === client) {
      terminals.close(terminal_id);
      owners.delete(terminal_id);
    }
  }
};

const owns_terminal = (client: ClientId, terminal_id: string, action: string): boolean => {
  const owner = owners.get(terminal_id);
  if (owner === undefined) {
    return false;
  }
  if (owner === client) {
    return true;
  }
  console.warn(`[terminal] ignored ${action} of terminal ${terminal_id.slice(0, 80)} from ${client}, it belongs to ${owner}`);
  return false;
};

let watched: WebContents | null = null;

const watch_renderer = () => {
  const contents = main_window()?.webContents;
  if (!contents || contents === watched) {
    return;
  }
  watched = contents;
  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      close_client_terminals(window_client);
    }
  });
  contents.on("destroyed", () => close_client_terminals(window_client));
};

on_client_gone(close_client_terminals);

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

const terminal_cwd = async (scope: FilesScope) => {
  const root = await files_root(scope);
  if (!root) {
    return os.homedir();
  }
  if (root.worktree?.missing) {
    throw worktree_missing(root.path);
  }
  const stat = await fs.stat(root.path).catch((error: unknown) => {
    throw new Error(`terminal cwd ${root.path} is not accessible: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!stat.isDirectory()) {
    throw new Error(`terminal cwd ${root.path} is not a directory`);
  }
  return root.path;
};

const create_terminal = async (client: ClientId, request: TerminalCreate) => {
  const scope = parse_scope(request);
  const cwd = await terminal_cwd(scope);
  watch_renderer();
  const terminal_id = terminals.create(scope.chat_id, { cwd, cols: require_size(request.cols, "cols"), rows: require_size(request.rows, "rows") });
  owners.set(terminal_id, client);
  return terminal_id;
};

const adopt_terminal = (terminal_id: unknown, chat_id: unknown) => {
  const owner = require_text(chat_id, "chat_id");
  if (!chat_meta(owner)) {
    throw new Error(`chat ${owner} does not exist, terminal ${String(terminal_id)} stays without a chat`);
  }
  terminals.adopt(require_text(terminal_id, "terminal_id"), owner);
};

const close_terminal = (client: ClientId, terminal_id: string) => {
  if (!owns_terminal(client, terminal_id, "close")) {
    return;
  }
  terminals.close(terminal_id);
  owners.delete(terminal_id);
};

export const register_terminal_ipc = () => {
  handle_client("terminal:create", create_terminal);
  handle("terminal:adopt", adopt_terminal);
  listen_client("terminal:input", (client, terminal_id, data) => {
    const id = require_text(terminal_id, "terminal_id");
    if (owns_terminal(client, id, "input")) {
      terminals.input(id, require_text(data, "data"));
    }
  });
  listen_client("terminal:resize", (client, terminal_id, cols, rows) => {
    const id = require_text(terminal_id, "terminal_id");
    if (owns_terminal(client, id, "resize")) {
      terminals.resize(id, require_size(cols, "cols"), require_size(rows, "rows"));
    }
  });
  listen_client("terminal:close", (client, terminal_id) => close_terminal(client, require_text(terminal_id, "terminal_id")));
};

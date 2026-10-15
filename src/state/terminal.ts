import { api } from "../api/bridge.ts";
import { draft_key } from "./chat-drafts.ts";
import { create_store } from "./create-store.ts";
import { drop_group, drop_tab, find_terminal_tab, move_group, patch_tab, pick_tab, put_tab, terminal_group, type TerminalState, type TerminalTab } from "./terminal-groups.ts";
import { ui_store } from "./ui.ts";

export type TerminalOutput = { data: (text: string) => void; exit: (exit_code: number) => void; release: () => void };

export const terminal_store = create_store<TerminalState>({ groups: {} });

const early_limit = 262144;

const pty_ids = new Map<string, string>();
const pty_tabs = new Map<string, string>();
const outputs = new Map<string, TerminalOutput>();
const early_output = new Map<string, string>();
const early_exit = new Map<string, number>();
const closed = new Set<string>();

const find_tab = (tab_id: string) => find_terminal_tab(terminal_store.get(), tab_id);

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const add_terminal_tab = (chat_id: string | null, project_path: string): string => {
  const id = crypto.randomUUID();
  const tab: TerminalTab = { id, chat_id, project_path, status: "starting", exit_code: null, error: "" };
  terminal_store.update((state) => put_tab(state, draft_key(chat_id, project_path), tab));
  return id;
};

export const ensure_terminal_tab = (chat_id: string | null, project_path: string) => {
  if (terminal_group(terminal_store.get(), draft_key(chat_id, project_path)).tabs.length === 0) {
    add_terminal_tab(chat_id, project_path);
  }
};

export const select_terminal_tab = (tab_id: string) => terminal_store.update((state) => pick_tab(state, tab_id));

const unlink = (tab_id: string) => {
  const pty_id = pty_ids.get(tab_id);
  if (pty_id === undefined) {
    return null;
  }
  pty_ids.delete(tab_id);
  pty_tabs.delete(pty_id);
  return pty_id;
};

const finish = (tab_id: string, exit_code: number) => {
  unlink(tab_id);
  outputs.get(tab_id)?.exit(exit_code);
  terminal_store.update((state) => patch_tab(state, tab_id, { status: "exited", exit_code }));
};

const claim = (tab_id: string, pty_id: string) => {
  pty_ids.set(tab_id, pty_id);
  pty_tabs.set(pty_id, tab_id);
  terminal_store.update((state) => patch_tab(state, tab_id, { status: "running" }));
  const buffered = early_output.get(pty_id);
  early_output.delete(pty_id);
  if (buffered) {
    outputs.get(tab_id)?.data(buffered);
  }
  const exit_code = early_exit.get(pty_id);
  early_exit.delete(pty_id);
  if (exit_code !== undefined) {
    finish(tab_id, exit_code);
  }
};

const close_pty = (pty_id: string) => {
  closed.add(pty_id);
  early_output.delete(pty_id);
  early_exit.delete(pty_id);
  api.send("terminal:close", pty_id);
};

const adopt_pty = (pty_id: string, chat_id: string) => {
  api.invoke("terminal:adopt", pty_id, chat_id).catch((error: unknown) => console.error(`[terminal] terminal:adopt failed for terminal ${pty_id} in chat ${chat_id}`, error));
};

export const start_terminal = async (tab_id: string, cols: number, rows: number, output: TerminalOutput): Promise<boolean> => {
  const tab = find_tab(tab_id);
  if (!tab || outputs.has(tab_id) || tab.status !== "starting") {
    return false;
  }
  outputs.set(tab_id, output);
  try {
    const pty_id = await api.invoke("terminal:create", { chat_id: tab.chat_id, project_path: tab.project_path, cols, rows });
    const current = find_tab(tab_id);
    if (!current) {
      close_pty(pty_id);
      return false;
    }
    if (current.chat_id !== null && current.chat_id !== tab.chat_id) {
      adopt_pty(pty_id, current.chat_id);
    }
    claim(tab_id, pty_id);
    return true;
  } catch (error) {
    console.error(`[terminal] terminal:create failed for chat ${tab.chat_id ?? "none"} in ${tab.project_path || "no project"}`, error);
    terminal_store.update((state) => patch_tab(state, tab_id, { status: "failed", error: error_text(error) }));
    return false;
  }
};

export const write_terminal = (tab_id: string, data: string) => {
  const pty_id = pty_ids.get(tab_id);
  if (pty_id) {
    api.send("terminal:input", pty_id, data);
  }
};

export const resize_terminal = (tab_id: string, cols: number, rows: number) => {
  const pty_id = pty_ids.get(tab_id);
  if (pty_id) {
    api.send("terminal:resize", pty_id, cols, rows);
  }
};

const release_tab = (tab_id: string) => {
  const pty_id = unlink(tab_id);
  if (pty_id !== null) {
    close_pty(pty_id);
  }
  outputs.get(tab_id)?.release();
  outputs.delete(tab_id);
};

export const close_terminal_tab = (tab_id: string) => {
  release_tab(tab_id);
  terminal_store.update((state) => drop_tab(state, tab_id));
};

export const adopt_terminals = (from_key: string, chat_id: string) => {
  const moving = terminal_group(terminal_store.get(), from_key).tabs;
  terminal_store.update((state) => move_group(state, from_key, chat_id));
  for (const tab of moving) {
    const pty_id = pty_ids.get(tab.id);
    if (pty_id !== undefined) {
      adopt_pty(pty_id, chat_id);
    }
  }
};

const drop_chat_terminals = (chat_id: string) => {
  for (const tab of terminal_group(terminal_store.get(), chat_id).tabs) {
    release_tab(tab.id);
  }
  terminal_store.update((state) => drop_group(state, chat_id));
};

const receive_data = (pty_id: string, data: string) => {
  const tab_id = pty_tabs.get(pty_id);
  if (tab_id !== undefined) {
    outputs.get(tab_id)?.data(data);
    return;
  }
  if (closed.has(pty_id)) {
    return;
  }
  early_output.set(pty_id, ((early_output.get(pty_id) ?? "") + data).slice(-early_limit));
};

const receive_exit = (pty_id: string, exit_code: number) => {
  const tab_id = pty_tabs.get(pty_id);
  if (tab_id !== undefined) {
    finish(tab_id, exit_code);
    return;
  }
  if (closed.delete(pty_id)) {
    return;
  }
  early_exit.set(pty_id, exit_code);
};

const watch_panel = () => {
  let open = ui_store.get().dock.kind === "terminal";
  return ui_store.subscribe(() => {
    const { dock, active_chat_id, project_path } = ui_store.get();
    const opened = dock.kind === "terminal" && !open;
    open = dock.kind === "terminal";
    if (opened) {
      ensure_terminal_tab(active_chat_id, project_path);
    }
  });
};

export const init_terminal = (): (() => void) => {
  const stop_panel = watch_panel();
  const stop_data = api.on("terminal:data", ({ terminal_id, data }) => receive_data(terminal_id, data));
  const stop_exit = api.on("terminal:exit", ({ terminal_id, exit_code }) => receive_exit(terminal_id, exit_code));
  const stop_removed = api.on("chats:removed", ({ chat_id }) => drop_chat_terminals(chat_id));
  return () => {
    stop_panel();
    stop_data();
    stop_exit();
    stop_removed();
  };
};

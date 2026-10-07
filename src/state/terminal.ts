import { api } from "../api/bridge.ts";
import { create_store } from "./create-store.ts";

export type TerminalTabStatus = "starting" | "running" | "exited" | "failed";

export type TerminalTab = { id: string; cwd: string; status: TerminalTabStatus; exit_code: number | null; error: string };

export type TerminalState = { tabs: TerminalTab[]; active_id: string | null };

export type TerminalOutput = { data: (text: string) => void; exit: (exit_code: number) => void };

export const terminal_store = create_store<TerminalState>({ tabs: [], active_id: null });

const early_limit = 262144;

const pty_ids = new Map<string, string>();
const outputs = new Map<string, TerminalOutput>();
const early_output = new Map<string, string>();
const early_exit = new Map<string, number>();
const closed = new Set<string>();

const find_tab = (tab_id: string) => terminal_store.get().tabs.find((tab) => tab.id === tab_id) ?? null;

const patch_tab = (tab_id: string, patch: Partial<TerminalTab>) =>
  terminal_store.update((state) => ({ ...state, tabs: state.tabs.map((tab) => (tab.id === tab_id ? { ...tab, ...patch } : tab)) }));

const tab_of_pty = (pty_id: string) => [...pty_ids].find(([, id]) => id === pty_id)?.[0] ?? null;

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const add_terminal_tab = (cwd: string): string => {
  const id = crypto.randomUUID();
  const tab: TerminalTab = { id, cwd, status: "starting", exit_code: null, error: "" };
  terminal_store.update((state) => ({ tabs: [...state.tabs, tab], active_id: id }));
  return id;
};

export const ensure_terminal_tab = (cwd: string) => {
  if (terminal_store.get().tabs.length === 0) {
    add_terminal_tab(cwd);
  }
};

export const select_terminal_tab = (tab_id: string) => {
  if (find_tab(tab_id)) {
    terminal_store.update((state) => ({ ...state, active_id: tab_id }));
  }
};

const finish = (tab_id: string, pty_id: string, exit_code: number) => {
  outputs.get(pty_id)?.exit(exit_code);
  outputs.delete(pty_id);
  pty_ids.delete(tab_id);
  patch_tab(tab_id, { status: "exited", exit_code });
};

const claim = (tab_id: string, pty_id: string, output: TerminalOutput) => {
  pty_ids.set(tab_id, pty_id);
  outputs.set(pty_id, output);
  patch_tab(tab_id, { status: "running" });
  const buffered = early_output.get(pty_id);
  early_output.delete(pty_id);
  if (buffered) {
    output.data(buffered);
  }
  const exit_code = early_exit.get(pty_id);
  early_exit.delete(pty_id);
  if (exit_code !== undefined) {
    finish(tab_id, pty_id, exit_code);
  }
};

export const start_terminal = async (tab_id: string, cols: number, rows: number, output: TerminalOutput): Promise<boolean> => {
  const tab = find_tab(tab_id);
  if (!tab || pty_ids.has(tab_id) || tab.status !== "starting") {
    return false;
  }
  try {
    const pty_id = await api.invoke("terminal:create", { cwd: tab.cwd, cols, rows });
    if (!find_tab(tab_id)) {
      closed.add(pty_id);
      early_output.delete(pty_id);
      early_exit.delete(pty_id);
      api.send("terminal:close", pty_id);
      return false;
    }
    claim(tab_id, pty_id, output);
    return true;
  } catch (error) {
    console.error(`[terminal] terminal:create failed for cwd ${tab.cwd}`, error);
    patch_tab(tab_id, { status: "failed", error: error_text(error) });
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

export const close_terminal_tab = (tab_id: string) => {
  const pty_id = pty_ids.get(tab_id);
  if (pty_id) {
    pty_ids.delete(tab_id);
    outputs.delete(pty_id);
    closed.add(pty_id);
    api.send("terminal:close", pty_id);
  }
  terminal_store.update((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === tab_id);
    if (index === -1) {
      return state;
    }
    const tabs = state.tabs.filter((tab) => tab.id !== tab_id);
    const active_id = state.active_id === tab_id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.active_id;
    return { tabs, active_id };
  });
};

const receive_data = (pty_id: string, data: string) => {
  const output = outputs.get(pty_id);
  if (output) {
    output.data(data);
    return;
  }
  if (closed.has(pty_id)) {
    return;
  }
  early_output.set(pty_id, ((early_output.get(pty_id) ?? "") + data).slice(-early_limit));
};

const receive_exit = (pty_id: string, exit_code: number) => {
  const tab_id = tab_of_pty(pty_id);
  if (tab_id) {
    finish(tab_id, pty_id, exit_code);
    return;
  }
  if (closed.delete(pty_id)) {
    return;
  }
  early_exit.set(pty_id, exit_code);
};

export const init_terminal = (): (() => void) => {
  const stop_data = api.on("terminal:data", ({ terminal_id, data }) => receive_data(terminal_id, data));
  const stop_exit = api.on("terminal:exit", ({ terminal_id, exit_code }) => receive_exit(terminal_id, exit_code));
  return () => {
    stop_data();
    stop_exit();
  };
};

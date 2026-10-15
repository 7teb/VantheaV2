export type TerminalTabStatus = "starting" | "running" | "exited" | "failed";

export type TerminalTab = { id: string; chat_id: string | null; project_path: string; status: TerminalTabStatus; exit_code: number | null; error: string };

export type TerminalGroup = { tabs: TerminalTab[]; active_id: string | null };

export type TerminalState = { groups: Record<string, TerminalGroup> };

const no_group: TerminalGroup = { tabs: [], active_id: null };

export const terminal_group = (state: TerminalState, key: string): TerminalGroup => state.groups[key] ?? no_group;

export const group_of_tab = (state: TerminalState, tab_id: string): string | null =>
  Object.keys(state.groups).find((key) => state.groups[key].tabs.some((tab) => tab.id === tab_id)) ?? null;

export const find_terminal_tab = (state: TerminalState, tab_id: string): TerminalTab | null => {
  const key = group_of_tab(state, tab_id);
  return key === null ? null : (state.groups[key].tabs.find((tab) => tab.id === tab_id) ?? null);
};

const with_group = (state: TerminalState, key: string, group: TerminalGroup | null): TerminalState => {
  const rest = Object.fromEntries(Object.entries(state.groups).filter(([entry]) => entry !== key));
  return { groups: group === null || group.tabs.length === 0 ? rest : { ...rest, [key]: group } };
};

export const put_tab = (state: TerminalState, key: string, tab: TerminalTab): TerminalState => {
  const group = terminal_group(state, key);
  return with_group(state, key, { tabs: [...group.tabs, tab], active_id: tab.id });
};

export const pick_tab = (state: TerminalState, tab_id: string): TerminalState => {
  const key = group_of_tab(state, tab_id);
  return key === null ? state : with_group(state, key, { ...state.groups[key], active_id: tab_id });
};

export const patch_tab = (state: TerminalState, tab_id: string, patch: Partial<TerminalTab>): TerminalState => {
  const key = group_of_tab(state, tab_id);
  if (key === null) {
    return state;
  }
  const group = state.groups[key];
  return with_group(state, key, { ...group, tabs: group.tabs.map((tab) => (tab.id === tab_id ? { ...tab, ...patch } : tab)) });
};

export const drop_tab = (state: TerminalState, tab_id: string): TerminalState => {
  const key = group_of_tab(state, tab_id);
  if (key === null) {
    return state;
  }
  const group = state.groups[key];
  const index = group.tabs.findIndex((tab) => tab.id === tab_id);
  const tabs = group.tabs.filter((tab) => tab.id !== tab_id);
  const active_id = group.active_id === tab_id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : group.active_id;
  return with_group(state, key, { tabs, active_id });
};

export const drop_group = (state: TerminalState, key: string): TerminalState => with_group(state, key, null);

export const move_group = (state: TerminalState, from: string, chat_id: string): TerminalState => {
  const moving = state.groups[from];
  if (!moving) {
    return state;
  }
  const target = terminal_group(state, chat_id);
  const tabs = [...target.tabs, ...moving.tabs.map((tab) => ({ ...tab, chat_id }))];
  return with_group(drop_group(state, from), chat_id, { tabs, active_id: moving.active_id });
};

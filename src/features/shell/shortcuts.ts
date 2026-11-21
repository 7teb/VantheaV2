import type { MessageKey, Translate } from "../../i18n/translate.ts";

export type AppShortcutId =
  | "new_chat"
  | "open_project"
  | "toggle_sidebar"
  | "search"
  | "settings"
  | "prev_chat"
  | "next_chat"
  | "zoom_in"
  | "zoom_out"
  | "zoom_reset"
  | "fullscreen"
  | "close_layer"
  | "focus_composer"
  | "toggle_terminal"
  | "toggle_files"
  | "toggle_browser"
  | "toggle_tasks"
  | "copy_answer"
  | "dictate"
  | "toggle_plan";

export type LocalShortcutId = "stop_turn" | "send" | "queue";

export type ShortcutId = AppShortcutId | LocalShortcutId;

type Modifier = boolean | "any";

export type KeyCombo = { key: string; ctrl: Modifier; shift: Modifier; alt: Modifier };

export type Shortcut = { label: MessageKey; combos: KeyCombo[] };

export type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

const ctrl = (key: string, shift: Modifier = false): KeyCombo => ({ key, ctrl: true, shift, alt: false });

const bare = (key: string): KeyCombo => ({ key, ctrl: false, shift: false, alt: false });

const shifted = (key: string): KeyCombo => ({ key, ctrl: false, shift: true, alt: false });

const shortcut = (label: MessageKey, ...combos: KeyCombo[]): Shortcut => ({ label, combos });

const app_shortcuts: Record<AppShortcutId, Shortcut> = {
  new_chat: shortcut("shortcuts.new_chat", ctrl("n")),
  open_project: shortcut("shortcuts.open_project", ctrl("o")),
  toggle_sidebar: shortcut("shortcuts.toggle_sidebar", ctrl("b")),
  search: shortcut("shortcuts.search", ctrl("f")),
  settings: shortcut("shortcuts.settings", ctrl(",")),
  prev_chat: shortcut("shortcuts.prev_chat", ctrl("arrowup", true)),
  next_chat: shortcut("shortcuts.next_chat", ctrl("arrowdown", true)),
  zoom_in: shortcut("shortcuts.zoom_in", ctrl("+", "any"), ctrl("=", "any")),
  zoom_out: shortcut("shortcuts.zoom_out", ctrl("-", "any")),
  zoom_reset: shortcut("shortcuts.actual_size", ctrl("0")),
  fullscreen: shortcut("shortcuts.fullscreen", bare("f11")),
  close_layer: shortcut("common.close", bare("escape")),
  focus_composer: shortcut("shortcuts.focus_composer", shifted("escape")),
  toggle_terminal: shortcut("shortcuts.toggle_terminal", ctrl("j")),
  toggle_files: shortcut("shortcuts.toggle_files", ctrl("e", true)),
  toggle_browser: shortcut("shortcuts.toggle_browser", ctrl("b", true)),
  toggle_tasks: shortcut("shortcuts.toggle_tasks", ctrl("a", true)),
  copy_answer: shortcut("shortcuts.copy_answer", ctrl("c", true)),
  dictate: shortcut("shortcuts.dictate", ctrl("d")),
  toggle_plan: shortcut("shortcuts.toggle_plan", ctrl("p", true)),
};

const local_shortcuts: Record<LocalShortcutId, Shortcut> = {
  stop_turn: shortcut("shortcuts.stop_turn", bare("escape")),
  send: shortcut("shortcuts.send", { key: "enter", ctrl: "any", shift: false, alt: "any" }),
  queue: shortcut("shortcuts.queue", bare("tab")),
};

export const shortcuts: Record<ShortcutId, Shortcut> = { ...app_shortcuts, ...local_shortcuts };

const fits = (wanted: Modifier, pressed: boolean) => wanted === "any" || wanted === pressed;

const matches = (combo: KeyCombo, input: KeyInput) =>
  combo.key === input.key.toLowerCase() &&
  fits(combo.ctrl, input.ctrlKey || input.metaKey) &&
  fits(combo.alt, input.altKey) &&
  fits(combo.shift, input.shiftKey);

export const shortcut_matches = (id: ShortcutId, input: KeyInput): boolean => shortcuts[id].combos.some((combo) => matches(combo, input));

const app_ids = Object.keys(app_shortcuts) as AppShortcutId[];

export const match_shortcut = (input: KeyInput): AppShortcutId | null => app_ids.find((id) => shortcut_matches(id, input)) ?? null;

const key_names: Record<string, string> = { escape: "Esc", f11: "F11", tab: "Tab", "=": "+" };

const spoken_keys: Record<string, MessageKey> = { arrowup: "shortcuts.key_up", arrowdown: "shortcuts.key_down", enter: "shortcuts.key_enter" };

const key_label = (key: string, t: Translate) => {
  const spoken = spoken_keys[key];
  if (spoken) {
    return t(spoken);
  }
  return key_names[key] ?? key.toUpperCase();
};

const format_combo = (combo: KeyCombo, t: Translate) => {
  const parts = [
    combo.ctrl === true && t("shortcuts.key_ctrl"),
    combo.alt === true && t("shortcuts.key_alt"),
    combo.shift === true && t("shortcuts.key_shift"),
    key_label(combo.key, t),
  ];
  return parts.filter(Boolean).join("+");
};

export const shortcut_hint = (id: ShortcutId, t: Translate): string => format_combo(shortcuts[id].combos[0], t);

import type { MessageKey } from "../../i18n/translate.ts";

export type ShortcutId =
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
  | "close_layer";

export type KeyCombo = { key: string; ctrl: boolean; shift: boolean | "any"; alt: boolean };

export type Shortcut = { label: MessageKey; combos: KeyCombo[] };

export type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

const ctrl = (key: string, shift: boolean | "any" = false): KeyCombo => ({ key, ctrl: true, shift, alt: false });

const bare = (key: string): KeyCombo => ({ key, ctrl: false, shift: false, alt: false });

export const shortcuts: Record<ShortcutId, Shortcut> = {
  new_chat: { label: "shortcuts.new_chat", combos: [ctrl("n")] },
  open_project: { label: "shortcuts.open_project", combos: [ctrl("o")] },
  toggle_sidebar: { label: "shortcuts.toggle_sidebar", combos: [ctrl("b")] },
  search: { label: "shortcuts.search", combos: [ctrl("f")] },
  settings: { label: "shortcuts.settings", combos: [ctrl(",")] },
  prev_chat: { label: "shortcuts.prev_chat", combos: [ctrl("arrowup", true)] },
  next_chat: { label: "shortcuts.next_chat", combos: [ctrl("arrowdown", true)] },
  zoom_in: { label: "shortcuts.zoom_in", combos: [ctrl("+", "any"), ctrl("=", "any")] },
  zoom_out: { label: "shortcuts.zoom_out", combos: [ctrl("-", "any")] },
  zoom_reset: { label: "shortcuts.actual_size", combos: [ctrl("0")] },
  fullscreen: { label: "shortcuts.fullscreen", combos: [bare("f11")] },
  close_layer: { label: "common.close", combos: [bare("escape")] },
};

const matches = (combo: KeyCombo, input: KeyInput) =>
  combo.key === input.key.toLowerCase() &&
  combo.ctrl === (input.ctrlKey || input.metaKey) &&
  combo.alt === input.altKey &&
  (combo.shift === "any" || combo.shift === input.shiftKey);

const shortcut_ids = Object.keys(shortcuts) as ShortcutId[];

export const match_shortcut = (input: KeyInput): ShortcutId | null =>
  shortcut_ids.find((id) => shortcuts[id].combos.some((combo) => matches(combo, input))) ?? null;

const key_names: Record<string, string> = { arrowup: "Up", arrowdown: "Down", escape: "Esc", f11: "F11", "=": "+" };

const format_combo = (combo: KeyCombo) => {
  const parts = [combo.ctrl && "Ctrl", combo.alt && "Alt", combo.shift === true && "Shift", key_names[combo.key] ?? combo.key.toUpperCase()];
  return parts.filter(Boolean).join("+");
};

export const shortcut_hint = (id: ShortcutId): string => format_combo(shortcuts[id].combos[0]);

import assert from "node:assert/strict";
import { test } from "node:test";
import { match_shortcut, shortcut_hint, shortcuts, type KeyInput, type ShortcutId } from "../src/features/shell/shortcuts.ts";

const key = (value: string, modifiers: Partial<Omit<KeyInput, "key">> = {}): KeyInput => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

test("ctrl shortcuts match case-insensitively and require ctrl", () => {
  assert.equal(match_shortcut(key("n", { ctrlKey: true })), "new_chat");
  assert.equal(match_shortcut(key("N", { ctrlKey: true })), "new_chat");
  assert.equal(match_shortcut(key("b", { ctrlKey: true })), "toggle_sidebar");
  assert.equal(match_shortcut(key("f", { ctrlKey: true })), "search");
  assert.equal(match_shortcut(key(",", { ctrlKey: true })), "settings");
  assert.equal(match_shortcut(key("n")), null);
  assert.equal(match_shortcut(key("n", { ctrlKey: true, altKey: true })), null);
  assert.equal(match_shortcut(key("n", { ctrlKey: true, shiftKey: true })), null);
});

test("zoom keys work with and without shift across layouts", () => {
  assert.equal(match_shortcut(key("+", { ctrlKey: true, shiftKey: true })), "zoom_in");
  assert.equal(match_shortcut(key("+", { ctrlKey: true })), "zoom_in");
  assert.equal(match_shortcut(key("=", { ctrlKey: true })), "zoom_in");
  assert.equal(match_shortcut(key("-", { ctrlKey: true })), "zoom_out");
  assert.equal(match_shortcut(key("0", { ctrlKey: true })), "zoom_reset");
});

test("bare keys and chat stepping", () => {
  assert.equal(match_shortcut(key("F11")), "fullscreen");
  assert.equal(match_shortcut(key("Escape")), "close_layer");
  assert.equal(match_shortcut(key("Escape", { ctrlKey: true })), null);
  assert.equal(match_shortcut(key("ArrowUp", { ctrlKey: true, shiftKey: true })), "prev_chat");
  assert.equal(match_shortcut(key("ArrowDown", { metaKey: true, shiftKey: true })), "next_chat");
  assert.equal(match_shortcut(key("ArrowDown", { ctrlKey: true })), null);
});

test("no two shortcuts share a key combination", () => {
  const seen = new Map<string, ShortcutId>();
  for (const [id, shortcut] of Object.entries(shortcuts) as [ShortcutId, (typeof shortcuts)[ShortcutId]][]) {
    for (const combo of shortcut.combos) {
      const shifts = combo.shift === "any" ? [true, false] : [combo.shift];
      for (const shift of shifts) {
        const signature = `${combo.ctrl}:${shift}:${combo.alt}:${combo.key}`;
        assert.equal(seen.get(signature), undefined, `${id} collides with ${seen.get(signature)}`);
        seen.set(signature, id);
      }
    }
  }
});

test("hints are formatted for menus and tooltips", () => {
  assert.equal(shortcut_hint("new_chat"), "Ctrl+N");
  assert.equal(shortcut_hint("settings"), "Ctrl+,");
  assert.equal(shortcut_hint("prev_chat"), "Ctrl+Shift+Up");
  assert.equal(shortcut_hint("zoom_in"), "Ctrl++");
  assert.equal(shortcut_hint("fullscreen"), "F11");
  assert.equal(shortcut_hint("close_layer"), "Esc");
});

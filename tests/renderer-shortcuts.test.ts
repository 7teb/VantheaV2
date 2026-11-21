import assert from "node:assert/strict";
import { test } from "node:test";
import { match_shortcut, shortcut_hint, shortcut_matches, shortcuts, type KeyCombo, type KeyInput, type ShortcutId } from "../src/features/shell/shortcuts.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const key = (value: string, modifiers: Partial<Omit<KeyInput, "key">> = {}): KeyInput => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

const local_ids: ShortcutId[] = ["stop_turn", "send", "queue"];

const choices = (value: KeyCombo["ctrl"]) => (value === "any" ? [true, false] : [value]);

const inputs_of = (combo: KeyCombo): KeyInput[] =>
  choices(combo.ctrl).flatMap((ctrl) =>
    choices(combo.shift).flatMap((shift) => choices(combo.alt).map((alt) => key(combo.key, { ctrlKey: ctrl, shiftKey: shift, altKey: alt }))),
  );

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

test("panels, dictation, plan mode, copying and the composer focus have their keys", () => {
  assert.equal(match_shortcut(key("j", { ctrlKey: true })), "toggle_terminal");
  assert.equal(match_shortcut(key("E", { ctrlKey: true, shiftKey: true })), "toggle_files");
  assert.equal(match_shortcut(key("B", { ctrlKey: true, shiftKey: true })), "toggle_browser");
  assert.equal(match_shortcut(key("A", { ctrlKey: true, shiftKey: true })), "toggle_tasks");
  assert.equal(match_shortcut(key("C", { ctrlKey: true, shiftKey: true })), "copy_answer");
  assert.equal(match_shortcut(key("d", { ctrlKey: true })), "dictate");
  assert.equal(match_shortcut(key("P", { ctrlKey: true, shiftKey: true })), "toggle_plan");
  assert.equal(match_shortcut(key("Escape", { shiftKey: true })), "focus_composer");
  assert.equal(match_shortcut(key("d", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("j", { ctrlKey: true, shiftKey: true })), null);
});

test("altgr combinations never trigger a shortcut", () => {
  for (const letter of ["q", "e", "m", "d", "b", "7", "8", "9", "0"]) {
    assert.equal(match_shortcut(key(letter, { ctrlKey: true, altKey: true })), null, letter);
    assert.equal(match_shortcut(key(letter, { ctrlKey: true, altKey: true, shiftKey: true })), null, letter);
  }
});

test("text editing keys are never app shortcuts", () => {
  for (const letter of ["a", "c", "v", "x", "z", "y"]) {
    assert.equal(match_shortcut(key(letter, { ctrlKey: true })), null, `ctrl+${letter}`);
  }
  for (const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Backspace", "Delete", "Enter", "Tab", "PageUp", "PageDown"]) {
    assert.equal(match_shortcut(key(name)), null, name);
    assert.equal(match_shortcut(key(name, { shiftKey: true })), null, `shift+${name}`);
    assert.equal(match_shortcut(key(name, { ctrlKey: true })), null, `ctrl+${name}`);
  }
  for (const name of ["ArrowLeft", "ArrowRight", "Home", "End", "Enter"]) {
    assert.equal(match_shortcut(key(name, { ctrlKey: true, shiftKey: true })), null, `ctrl+shift+${name}`);
  }
  assert.equal(match_shortcut(key("V", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("Z", { ctrlKey: true, shiftKey: true })), null);
});

test("keys the browser engine or windows reserve stay unbound", () => {
  assert.equal(match_shortcut(key("w", { ctrlKey: true })), null);
  assert.equal(match_shortcut(key("r", { ctrlKey: true })), null);
  assert.equal(match_shortcut(key("R", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("I", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("Tab", { ctrlKey: true })), null);
  assert.equal(match_shortcut(key("Tab", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("F4", { altKey: true })), null);
  assert.equal(match_shortcut(key("Escape", { ctrlKey: true, shiftKey: true })), null);
  assert.equal(match_shortcut(key("Escape", { ctrlKey: true, altKey: true })), null);
});

test("composer keys are matched only where the composer asks for them", () => {
  assert.equal(shortcut_matches("send", key("Enter")), true);
  assert.equal(shortcut_matches("send", key("Enter", { ctrlKey: true })), true);
  assert.equal(shortcut_matches("send", key("Enter", { altKey: true })), true);
  assert.equal(shortcut_matches("send", key("Enter", { shiftKey: true })), false);
  assert.equal(shortcut_matches("queue", key("Tab")), true);
  assert.equal(shortcut_matches("queue", key("Tab", { shiftKey: true })), false);
  assert.equal(shortcut_matches("queue", key("Tab", { ctrlKey: true })), false);
  assert.equal(shortcut_matches("stop_turn", key("Escape")), true);
  assert.equal(shortcut_matches("stop_turn", key("Escape", { shiftKey: true })), false);
  for (const id of local_ids) {
    for (const combo of shortcuts[id].combos) {
      for (const input of inputs_of(combo)) {
        assert.notEqual(match_shortcut(input), id, id);
      }
    }
  }
});

test("every app shortcut combination reaches its own shortcut", () => {
  for (const id of (Object.keys(shortcuts) as ShortcutId[]).filter((entry) => !local_ids.includes(entry))) {
    for (const combo of shortcuts[id].combos) {
      for (const input of inputs_of(combo)) {
        assert.equal(match_shortcut(input), id, `${id} with ${JSON.stringify(input)}`);
      }
    }
  }
});

test("the composer keys never collide with an app shortcut", () => {
  for (const id of ["send", "queue"] as const) {
    for (const input of shortcuts[id].combos.flatMap(inputs_of)) {
      assert.equal(match_shortcut(input), null, `${id} with ${JSON.stringify(input)}`);
    }
  }
});

test("hints are formatted for menus and tooltips", () => {
  assert.equal(shortcut_hint("new_chat", en), "Ctrl+N");
  assert.equal(shortcut_hint("settings", en), "Ctrl+,");
  assert.equal(shortcut_hint("prev_chat", en), "Ctrl+Shift+Up");
  assert.equal(shortcut_hint("zoom_in", en), "Ctrl++");
  assert.equal(shortcut_hint("fullscreen", en), "F11");
  assert.equal(shortcut_hint("close_layer", en), "Esc");
  assert.equal(shortcut_hint("stop_turn", en), "Esc");
  assert.equal(shortcut_hint("focus_composer", en), "Shift+Esc");
  assert.equal(shortcut_hint("toggle_files", en), "Ctrl+Shift+E");
  assert.equal(shortcut_hint("dictate", en), "Ctrl+D");
  assert.equal(shortcut_hint("send", en), "Enter");
  assert.equal(shortcut_hint("queue", en), "Tab");
});

test("german hints use the german key names", () => {
  assert.equal(shortcut_hint("new_chat", de), "Strg+N");
  assert.equal(shortcut_hint("toggle_plan", de), "Strg+Umschalt+P");
  assert.equal(shortcut_hint("next_chat", de), "Strg+Umschalt+Nach-unten");
  assert.equal(shortcut_hint("focus_composer", de), "Umschalt+Esc");
  assert.equal(shortcut_hint("send", de), "Eingabe");
  assert.equal(shortcut_hint("stop_turn", de), "Esc");
});

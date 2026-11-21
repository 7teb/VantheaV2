import assert from "node:assert/strict";
import { test } from "node:test";
import { focus_target, yields_to_focus, type FocusElement } from "../src/features/shell/shortcut-targets.ts";
import { shortcuts, type ShortcutId } from "../src/features/shell/shortcuts.ts";

const element = (tagName: string, extra: Partial<FocusElement> = {}, inside: string[] = []): FocusElement => ({
  tagName,
  closest: (selector) => (inside.includes(selector) ? {} : null),
  ...extra,
});

test("focus targets classify the terminal, text fields and everything else", () => {
  assert.equal(focus_target(null), "other");
  assert.equal(focus_target(element("TEXTAREA", {}, [".xterm"])), "terminal");
  assert.equal(focus_target(element("DIV", {}, [".xterm"])), "terminal");
  assert.equal(focus_target(element("TEXTAREA", {}, [".composer-input"])), "composer");
  assert.equal(focus_target(element("TEXTAREA")), "text");
  assert.equal(focus_target(element("INPUT", { type: "text" })), "text");
  assert.equal(focus_target(element("INPUT", { type: "password" })), "text");
  assert.equal(focus_target(element("INPUT")), "text");
  assert.equal(focus_target(element("DIV", { isContentEditable: true })), "text");
  assert.equal(focus_target(element("INPUT", { type: "checkbox" })), "other");
  assert.equal(focus_target(element("INPUT", { type: "range" })), "other");
  assert.equal(focus_target(element("BUTTON")), "other");
  assert.equal(focus_target(element("DIV")), "other");
});

test("ctrl+b and ctrl+f yield to text fields and the terminal", () => {
  for (const target of ["text", "composer", "terminal"] as const) {
    assert.equal(yields_to_focus("toggle_sidebar", target), true);
    assert.equal(yields_to_focus("search", target), true);
  }
  assert.equal(yields_to_focus("toggle_sidebar", "other"), false);
  assert.equal(yields_to_focus("search", "other"), false);
});

test("the terminal keeps its control keys and app-level shortcuts stay global", () => {
  for (const id of ["new_chat", "open_project", "prev_chat", "next_chat"] as const) {
    assert.equal(yields_to_focus(id, "terminal"), true, id);
    assert.equal(yields_to_focus(id, "text"), false, id);
  }
  for (const id of ["settings", "zoom_in", "zoom_out", "zoom_reset", "fullscreen"] as const) {
    assert.equal(yields_to_focus(id, "terminal"), false, id);
    assert.equal(yields_to_focus(id, "text"), false, id);
  }
});

test("the terminal keeps ctrl+d, ctrl+shift+c and esc but panels toggle from it", () => {
  for (const id of ["dictate", "copy_answer", "stop_turn"] as const) {
    assert.equal(yields_to_focus(id, "terminal"), true, id);
  }
  for (const id of ["toggle_terminal", "toggle_files", "toggle_browser", "toggle_tasks", "focus_composer", "toggle_plan"] as const) {
    assert.equal(yields_to_focus(id, "terminal"), false, id);
  }
});

test("dictation, plan mode and copying work while typing; esc stops a turn only from the composer", () => {
  for (const target of ["text", "composer"] as const) {
    for (const id of ["dictate", "toggle_plan", "copy_answer", "focus_composer", "toggle_terminal"] as const) {
      assert.equal(yields_to_focus(id, target), false, `${id} in ${target}`);
    }
  }
  assert.equal(yields_to_focus("stop_turn", "composer"), false);
  assert.equal(yields_to_focus("stop_turn", "text"), true);
  assert.equal(yields_to_focus("stop_turn", "other"), false);
});

test("escape never yields so layers close from any focus", () => {
  for (const target of ["terminal", "composer", "text", "other"] as const) {
    assert.equal(yields_to_focus("close_layer", target), false, target);
  }
  for (const id of Object.keys(shortcuts) as ShortcutId[]) {
    assert.equal(yields_to_focus(id, "other"), false, id);
  }
});

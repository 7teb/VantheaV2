import assert from "node:assert/strict";
import { test } from "node:test";
import { close_top_layer, layer_count, push_layer } from "../src/components/layers.ts";
import { escape_fallback, type EscapeContext } from "../src/features/shell/escape-fallback.ts";
import { bind_shortcut, run_bound } from "../src/features/shell/shortcut-bindings.ts";

const context = (overrides: Partial<EscapeContext> = {}): EscapeContext => ({ consumed: false, focus: "other", dictating: false, busy: false, ...overrides });

test("esc closes the topmost layer first and one layer per press", () => {
  const closed: string[] = [];
  const remove_menu = push_layer(() => closed.push("menu"));
  const remove_dialog = push_layer(() => closed.push("dialog"));
  assert.equal(close_top_layer(), true);
  assert.deepEqual(closed, ["dialog"]);
  remove_dialog();
  assert.equal(close_top_layer(), true);
  assert.deepEqual(closed, ["dialog", "menu"]);
  remove_menu();
  assert.equal(layer_count(), 0);
  assert.equal(close_top_layer(), false);
});

test("an esc a local handler already used does nothing else", () => {
  assert.equal(escape_fallback(context({ consumed: true, busy: true })), null);
  assert.equal(escape_fallback(context({ consumed: true, dictating: true })), null);
});

test("a running dictation is cancelled before the turn is stopped", () => {
  assert.equal(escape_fallback(context({ dictating: true, busy: true })), "cancel_dictation");
  assert.equal(escape_fallback(context({ dictating: true, busy: true, focus: "composer" })), "cancel_dictation");
  assert.equal(escape_fallback(context({ dictating: true, focus: "text" })), "cancel_dictation");
});

test("esc stops the running turn from the composer or outside text fields", () => {
  assert.equal(escape_fallback(context({ busy: true })), "stop_turn");
  assert.equal(escape_fallback(context({ busy: true, focus: "composer" })), "stop_turn");
  assert.equal(escape_fallback(context({ busy: true, focus: "text" })), null);
  assert.equal(escape_fallback(context({ busy: false })), null);
  assert.equal(escape_fallback(context({ busy: false, focus: "composer" })), null);
});

test("esc in the terminal stays with the terminal", () => {
  assert.equal(escape_fallback(context({ busy: true, focus: "terminal" })), null);
  assert.equal(escape_fallback(context({ dictating: true, focus: "terminal" })), null);
});

test("the newest binding of a shortcut runs and unbinding hands it back", () => {
  assert.equal(run_bound("dictate"), false);
  const runs: string[] = [];
  const unbind_hero = bind_shortcut("dictate", () => {
    runs.push("hero");
    return true;
  });
  const unbind_docked = bind_shortcut("dictate", () => {
    runs.push("docked");
    return false;
  });
  assert.equal(run_bound("dictate"), false);
  unbind_docked();
  assert.equal(run_bound("dictate"), true);
  unbind_hero();
  assert.equal(run_bound("dictate"), false);
  assert.deepEqual(runs, ["docked", "hero"]);
});

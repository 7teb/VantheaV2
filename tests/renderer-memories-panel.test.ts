import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { close_panel, composer_panel_store, open_panel } from "../src/state/composer-panel.ts";

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("one composer panel is open at a time, for one composer key", () => {
  composer_panel_store.set(null);
  open_panel("chat-a", "memories");
  assert.deepEqual(composer_panel_store.get(), { key: "chat-a", panel: "memories" });
  open_panel("chat-a", "context");
  assert.deepEqual(composer_panel_store.get(), { key: "chat-a", panel: "context" });
  close_panel("chat-a", "memories");
  assert.deepEqual(composer_panel_store.get(), { key: "chat-a", panel: "context" });
  open_panel("chat-b", "memories");
  close_panel("chat-a", "memories");
  assert.deepEqual(composer_panel_store.get(), { key: "chat-b", panel: "memories" });
  close_panel("chat-b", "memories");
  assert.equal(composer_panel_store.get(), null);
});

test("the context panel sits next to the memories panel in the composer stack, above the tab with the queued list, and closes on Escape", () => {
  const slot = read("features/composer/ComposerSlot.tsx");
  const panel = read("features/composer/ContextPanel.tsx");
  assert.ok(slot.indexOf("<ContextPanel") > slot.indexOf("<MemoriesPanel"));
  assert.ok(slot.indexOf("<ContextPanel") < slot.indexOf("<ComposerTab"));
  assert.match(read("features/composer/ComposerTab.tsx"), /<QueuedList /);
  assert.match(panel, /className="context-panel composer-panel composer-dock-card raised-surface"/);
  assert.match(panel, /use_layer\(presence\.state === "open", close\)/);
  assert.match(panel, /onAnimationEnd=\{presence\.on_animation_end\}/);
});

test("the memories panel is a dock card in the composer stack, above the queued list, and closes on Escape", () => {
  const slot = read("features/composer/ComposerSlot.tsx");
  const panel = read("features/composer/MemoriesPanel.tsx");
  assert.ok(slot.indexOf("<MemoriesPanel") > slot.indexOf("<TodosPanel"));
  assert.ok(slot.indexOf("<MemoriesPanel") < slot.indexOf("<ComposerTab"));
  assert.match(panel, /className="memories-panel composer-panel composer-dock-card raised-surface"/);
  assert.match(panel, /use_layer\(presence\.state === "open", close\)/);
  assert.match(panel, /onAnimationEnd=\{presence\.on_animation_end\}/);
  assert.match(panel, /add_memory\(text\)/);
  assert.match(panel, /remove_memory\(record\.id\)/);
});

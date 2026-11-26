import assert from "node:assert/strict";
import { test } from "node:test";
import { close_panel, composer_panel_store, open_panel } from "../src/state/composer-panel.ts";

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

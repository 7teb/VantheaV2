import assert from "node:assert/strict";
import { test } from "node:test";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";

test("the accent color setting keeps a lowercase #rrggbb or the empty default and ignores anything else", () => {
  const base = default_settings();
  assert.equal(base.accent_color, "");
  assert.equal(normalize_settings({ accent_color: "#FF0000" }, base).accent_color, "#ff0000");
  assert.equal(normalize_settings({ accent_color: " #3fb950 " }, base).accent_color, "#3fb950");
  for (const value of ["red", "#fff", "#12345g", "#1234567", 42, null]) {
    assert.equal(normalize_settings({ accent_color: value }, { ...base, accent_color: "#4f8ff7" }).accent_color, "#4f8ff7", String(value));
  }
  const chosen = merge_settings(base, { accent_color: "#e85aad" });
  assert.equal(chosen.accent_color, "#e85aad");
  assert.equal(merge_settings(chosen, { accent_color: "" }).accent_color, "");
  assert.equal(merge_settings(chosen, { language: "de" }).accent_color, "#e85aad");
});

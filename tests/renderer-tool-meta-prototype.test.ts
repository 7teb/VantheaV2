import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolStep } from "../shared/chat.ts";
import type { ToolView, ToolViewKind } from "../shared/tool-view.ts";
import { kind_meta, tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);
const inherited = [...new Set([...Object.getOwnPropertyNames(Object.prototype), "__proto__", "prototype", "unknown_tool"])];
const step = (name: string, view: ToolView | null, status: ToolStep["status"] = "done", args: Record<string, unknown> = {}): ToolStep => ({
  id: "tool:1:0", round: 1, kind: "tool", index: 0, call_id: "call", name, args, status, progress: null, approval: null, view, error: null, result_text: "", started_at: 1, ended_at: 2,
});

test("prototype property names resolve to callable tool metadata in every visible status", () => {
  for (const name of inherited) {
    for (const status of ["queued", "running", "drafting", "awaiting_approval", "done", "failed", "denied", "cancelled"] as const) {
      const value = step(name, null, status);
      const label = tool_label(t, value);
      assert.equal(typeof tool_meta(value).done, "function", `${name} ${status}`);
      assert.equal(typeof label, "string", `${name} ${status}`);
      assert.ok(label.length > 0);
    }
  }
});

test("unknown and inherited view kinds use the fallback while known names still win", () => {
  for (const name of inherited) {
    const kind = name as ToolViewKind;
    const view = { kind } as ToolView;
    assert.equal(kind_meta(kind).icon, "clock", name);
    assert.equal(tool_meta(step("unknown", view)).icon, "clock", name);
    assert.equal(typeof tool_label(t, step("unknown", view)), "string", name);
    assert.equal(tool_meta(step("read_file", view, "done", { path: "a.ts" })).icon, "file");
  }
});

test("browser actions cannot select inherited translation keys", () => {
  const view: ToolView = { kind: "browser", action: "unknown", title: "Page", url: "https://example.com", detail: "" };
  for (const action of inherited) {
    for (const name of ["browser_tab", "browser_navigate"]) {
      assert.equal(typeof tool_label(t, step(name, view, "done", { action })), "string", `${name} ${action}`);
    }
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import { place } from "../src/components/placement.ts";
import { build_sidebar, chat_label, project_label, sidebar_order } from "../src/features/sidebar/sidebar-model.ts";
import { filter_sections } from "../src/features/settings/settings-search.ts";
import { scope_text } from "../src/features/tools/hook-text.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const viewport = { width: 1000, height: 800 };

test("floating layers open below the anchor and align to its start", () => {
  const placed = place({ left: 100, top: 100, width: 40, height: 30 }, { width: 200, height: 150 }, "bottom-start", viewport);
  assert.deepEqual(placed, { side: "bottom", left: 100, top: 136 });
});

test("floating layers flip above when there is no room below", () => {
  const placed = place({ left: 100, top: 700, width: 40, height: 30 }, { width: 200, height: 150 }, "bottom-start", viewport);
  assert.equal(placed.side, "top");
  assert.equal(placed.top, 700 - 6 - 150);
});

test("floating layers stay inside the viewport horizontally", () => {
  const right = place({ left: 950, top: 100, width: 40, height: 30 }, { width: 200, height: 150 }, "bottom-start", viewport);
  assert.equal(right.left, 1000 - 8 - 200);
  const end = place({ left: 10, top: 100, width: 40, height: 30 }, { width: 200, height: 150 }, "bottom-end", viewport);
  assert.equal(end.left, 8);
  const centered = place({ left: 480, top: 100, width: 40, height: 30 }, { width: 100, height: 20 }, "top-center", viewport);
  assert.deepEqual(centered, { side: "top", left: 450, top: 74 });
});

const chat = (id: string, project_path: string, updated_at: string, pinned = false): ChatMeta => ({
  id,
  title: id,
  project_path,
  workspace: "",
  pinned,
  created_at: updated_at,
  updated_at,
  message_count: 1,
  streaming: false,
});

test("sidebar groups pinned chats, project chats and loose chats newest first", () => {
  const projects = [
    { path: "D:\\work\\alpha", name: "", pinned: false, folder_id: "" },
    { path: "D:\\work\\beta", name: "Beta", pinned: true, folder_id: "" },
  ];
  const chats = [
    chat("a1", "d:/work/alpha/", "2026-10-01T00:00:00Z"),
    chat("a2", "D:\\work\\alpha", "2026-10-03T00:00:00Z"),
    chat("b1", "D:\\work\\beta", "2026-10-02T00:00:00Z", true),
    chat("x1", "", "2026-10-04T00:00:00Z"),
    chat("o1", "D:\\gone", "2026-09-01T00:00:00Z"),
  ];
  const model = build_sidebar(chats, projects);
  assert.deepEqual(model.pinned.map((entry) => entry.id), ["b1"]);
  assert.deepEqual(model.projects.map((group) => group.project.path), ["D:\\work\\beta", "D:\\work\\alpha"]);
  assert.deepEqual(model.projects[1].chats.map((entry) => entry.id), ["a2", "a1"]);
  assert.deepEqual(model.projects[0].chats, []);
  assert.deepEqual(model.loose.map((entry) => entry.id), ["x1", "o1"]);
  assert.deepEqual(sidebar_order(model, ["D:\\work\\alpha"]).map((entry) => entry.id), ["b1", "x1", "o1"]);
  assert.equal(project_label(projects[0]), "alpha");
  assert.equal(project_label(projects[1]), "Beta");
});

test("a hook scope without a project entry shows the last folder of a Windows path", () => {
  const t: Translate = (key, vars) => translate("en", key, vars);
  const projects = [{ path: "D:/work/alpha", name: "Alpha", pinned: false, folder_id: "" }];
  assert.equal(scope_text(t, { kind: "project", path: "D:\\Work\\Foo" }, projects), "Foo");
  assert.equal(scope_text(t, { kind: "project", path: "d:\\work\\alpha\\" }, projects), "Alpha");
  assert.equal(scope_text(t, { kind: "global" }, projects), "All projects");
});

test("untitled chats fall back to the new chat label", () => {
  const t: Translate = (key, vars) => translate("en", key, vars);
  assert.equal(chat_label(t, ""), "New chat");
  assert.equal(chat_label(t, "   "), "New chat");
  assert.equal(chat_label(t, "Fix the parser"), "Fix the parser");
});

test("settings search matches section labels and per-setting keywords", () => {
  const t: Translate = (key, vars) => translate("en", key, vars);
  const sections = [
    { id: "general", label: "settings.tab_general" as const, keywords: ["settings.api_key" as const] },
    { id: "skills", label: "settings.tab_skills" as const, keywords: [] },
  ];
  assert.deepEqual(filter_sections(sections, "", t).map((section) => section.id), ["general", "skills"]);
  assert.deepEqual(filter_sections(sections, "openrouter", t).map((section) => section.id), ["general"]);
  assert.deepEqual(filter_sections(sections, "  SKILL ", t).map((section) => section.id), ["skills"]);
  assert.deepEqual(filter_sections(sections, "nothing", t), []);
});

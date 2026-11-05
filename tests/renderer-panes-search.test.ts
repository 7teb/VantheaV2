import assert from "node:assert/strict";
import { test } from "node:test";
import { pane_search, type PaneId } from "../src/features/settings/pane-keywords.ts";
import { filter_sections } from "../src/features/settings/settings-search.ts";
import { tables, translate, type Translate } from "../src/i18n/translate.ts";

const sections = (Object.keys(pane_search) as PaneId[]).map((id) => ({ id, ...pane_search[id] }));

const search = (language: "en" | "de", query: string) => {
  const t: Translate = (key, vars) => translate(language, key, vars);
  return filter_sections(sections, query, t).map((section) => section.id);
};

test("every pane label and keyword resolves to text in both languages", () => {
  for (const section of sections) {
    for (const key of [section.label, ...section.keywords]) {
      assert.ok(tables.en[key]?.trim(), `en ${key}`);
      assert.ok(tables.de[key]?.trim(), `de ${key}`);
    }
    assert.ok(section.keywords.length >= 3, `${section.id} has too few keywords`);
    assert.equal(new Set(section.keywords).size, section.keywords.length, `${section.id} repeats a keyword`);
  }
});

test("english queries land on the pane that owns the setting", () => {
  assert.deepEqual(search("en", "tavily"), ["web_search"]);
  assert.deepEqual(search("en", "custom instructions"), ["personalization"]);
  assert.deepEqual(search("en", "memories"), ["personalization"]);
  assert.deepEqual(search("en", "quality"), ["image_gen"]);
  assert.deepEqual(search("en", "reconnect"), ["mcp"]);
  assert.deepEqual(search("en", "skill"), ["skills"]);
  assert.deepEqual(search("en", "news"), ["web_search"]);
});

test("german queries land on the same panes", () => {
  assert.deepEqual(search("de", "Treffer pro Suche"), ["web_search"]);
  assert.deepEqual(search("de", "erinnerungen"), ["personalization"]);
  assert.deepEqual(search("de", "Bildmodell"), ["image_gen"]);
  assert.deepEqual(search("de", "neu verbinden"), ["mcp"]);
  assert.deepEqual(search("de", "skill-ordner"), ["skills"]);
});

test("a query that matches nothing hides every pane", () => {
  assert.deepEqual(search("en", "zzz-no-such-setting"), []);
});

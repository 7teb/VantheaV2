import assert from "node:assert/strict";
import { test } from "node:test";
import { relative_time } from "../src/i18n/relative-time.ts";
import { tables, translate, type MessageKey, type Translate } from "../src/i18n/translate.ts";

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("en and de have identical key sets", () => {
  const en = Object.keys(tables.en).sort();
  const de = Object.keys(tables.de).sort();
  assert.deepEqual(de, en);
  assert.ok(en.length > 400);
});

test("every key is namespaced snake_case", () => {
  for (const key of Object.keys(tables.en)) {
    assert.match(key, /^[a-z][a-z_]*\.[a-z0-9_]+$/, key);
  }
});

const dashes = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

test("every string is non-empty and has no em or en dash", () => {
  for (const language of ["en", "de"] as const) {
    for (const [key, value] of Object.entries(tables[language])) {
      assert.ok(value.length > 0, `${language} ${key} is empty`);
      assert.ok(!dashes.some((dash) => value.includes(dash)), `${language} ${key} contains a dash`);
    }
  }
});

test("en and de use the same placeholders per key", () => {
  for (const key of Object.keys(tables.en) as MessageKey[]) {
    assert.deepEqual(placeholders(tables.de[key]), placeholders(tables.en[key]), key);
  }
});

test("removed features left no strings behind", () => {
  const removed = /goal|narrat|nvidia|video|theme|design|voice/i;
  for (const key of Object.keys(tables.en)) {
    assert.doesNotMatch(key, removed, key);
  }
});

test("translate fills variables and keeps unknown placeholders", () => {
  assert.equal(translate("en", "projects.delete_confirm_chats", { n: 3 }), "Really delete, with 3 chats?");
  assert.equal(translate("de", "projects.delete_confirm_chats", { n: 3 }), "Wirklich löschen, mit 3 Chats?");
  assert.equal(translate("en", "settings.balance_left", { remaining: "$1.00" }), "$1.00 of {limit} left");
  assert.equal(translate("en", "sidebar.new_chat"), "New chat");
});

test("relative_time buckets minutes, hours, days, weeks and months", () => {
  const t: Translate = (key, vars) => translate("en", key, vars);
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const minute = 60_000;
  assert.equal(relative_time(t, ago(20_000), now), "now");
  assert.equal(relative_time(t, ago(5 * minute), now), "5m");
  assert.equal(relative_time(t, ago(3 * 60 * minute), now), "3h");
  assert.equal(relative_time(t, ago(2 * 24 * 60 * minute), now), "2d");
  assert.equal(relative_time(t, ago(15 * 24 * 60 * minute), now), "2w");
  assert.equal(relative_time(t, ago(90 * 24 * 60 * minute), now), "3mo");
  assert.equal(relative_time(t, new Date(now + 5 * minute).toISOString(), now), "now");
});

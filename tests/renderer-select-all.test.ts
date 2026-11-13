import assert from "node:assert/strict";
import { test } from "node:test";
import { is_select_all, select_all_region } from "../src/features/shell/select-all.ts";

const key = (name: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: name,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

type FakeNode = { closest(selector: string): FakeNode | null; querySelector(selector: string): FakeNode | null };

const node = (enclosing: FakeNode | null, inner: FakeNode | null = null): FakeNode => ({ closest: () => enclosing, querySelector: () => inner });

const chat = node(null);

const file_text = node(null);

test("only Ctrl+A or Cmd+A without Shift or Alt selects all", () => {
  assert.equal(is_select_all(key("a")), true);
  assert.equal(is_select_all(key("A")), true);
  assert.equal(is_select_all(key("a", { ctrlKey: false, metaKey: true })), true);
  assert.equal(is_select_all(key("a", { ctrlKey: false })), false);
  assert.equal(is_select_all(key("a", { shiftKey: true })), false);
  assert.equal(is_select_all(key("a", { altKey: true })), false);
  assert.equal(is_select_all(key("c")), false);
});

test("a focused element selects the region it holds before the region around it", () => {
  assert.equal(select_all_region(node(chat, file_text), null), file_text);
  assert.equal(select_all_region(node(chat), node(file_text)), chat);
});

test("without focus the last clicked element picks the region, outside every region nothing is selected", () => {
  assert.equal(select_all_region(null, node(chat)), chat);
  assert.equal(select_all_region(null, node(null, file_text)), null);
  assert.equal(select_all_region(null, null), null);
});

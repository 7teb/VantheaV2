import assert from "node:assert/strict";
import { test } from "node:test";
import { change_text } from "../electron/permissions/review-action.ts";
import { change_mark, forget_chat_writes, record_write, write_entry } from "../electron/permissions/written-files.ts";

test("the write ledger ignores case and slash style and forgets one chat only", () => {
  record_write("chat-a", "C:\\Work\\Shop\\scripts\\x.ps1", { actor: "main", tool: "write_file", call_id: "c1", at: 10, sha256: "aa", prior_birthtime: null });
  record_write("chat-b", "C:/work/shop/scripts/x.ps1", { actor: "worker", tool: "replace_in_file", call_id: "c2", at: 11, sha256: "bb", prior_birthtime: null });
  assert.equal(write_entry("chat-a", "c:/work/shop/SCRIPTS/x.ps1")?.call_id, "c1");
  forget_chat_writes("chat-a");
  assert.equal(write_entry("chat-a", "C:\\Work\\Shop\\scripts\\x.ps1"), null);
  assert.equal(write_entry("chat-b", "C:\\Work\\Shop\\scripts\\x.ps1")?.call_id, "c2");
  forget_chat_writes("chat-b");
});

test("change marks: written with same bytes, written then changed, created and modified since the chat started, none", () => {
  record_write("chat-m", "D:/p/a.py", { actor: "main", tool: "write_file", call_id: "c1", at: 5, sha256: "same", prior_birthtime: null });
  assert.deepEqual(change_mark("chat-m", 100, "D:/p/a.py", "same", { mtime: 120, birthtime: 110 }), { kind: "written", actor: "main", tool: "write_file", at: 5, same_bytes: true, before_chat: false });
  assert.deepEqual(change_mark("chat-m", 100, "D:/p/a.py", "other", { mtime: 1, birthtime: 1 }), { kind: "written", actor: "main", tool: "write_file", at: 5, same_bytes: false, before_chat: false });
  assert.deepEqual(change_mark("chat-m", 100, "D:/p/b.py", "x", { mtime: 150, birthtime: 120 }), { kind: "created", at: 120 });
  assert.deepEqual(change_mark("chat-m", 100, "D:/p/b.py", "x", { mtime: 40, birthtime: 100 }), { kind: "created", at: 100 });
  assert.deepEqual(change_mark("chat-m", 100, "D:/p/b.py", "x", { mtime: 150, birthtime: 50 }), { kind: "modified", at: 150 });
  assert.equal(change_mark("chat-m", 100, "D:/p/b.py", "x", { mtime: 50, birthtime: 50 }), null);
  forget_chat_writes("chat-m");
});

test("a written mark keeps whether the file existed before the chat from the first write of that path", () => {
  record_write("chat-o", "D:/p/old.py", { actor: "main", tool: "replace_in_file", call_id: "c1", at: 120, sha256: "one", prior_birthtime: 40 });
  record_write("chat-o", "D:/p/old.py", { actor: "main", tool: "write_file", call_id: "c2", at: 130, sha256: "two", prior_birthtime: 121 });
  record_write("chat-o", "D:/p/made.py", { actor: "main", tool: "write_file", call_id: "c3", at: 140, sha256: "three", prior_birthtime: 110 });
  assert.deepEqual(change_mark("chat-o", 100, "D:/p/old.py", "two", { mtime: 130, birthtime: 130 }), { kind: "written", actor: "main", tool: "write_file", at: 130, same_bytes: true, before_chat: true });
  assert.deepEqual(change_mark("chat-o", 100, "D:/p/made.py", "three", { mtime: 140, birthtime: 140 }), { kind: "written", actor: "main", tool: "write_file", at: 140, same_bytes: true, before_chat: false });
  forget_chat_writes("chat-o");
});

test("change text names a file created in this chat apart from one modified since the chat started and an older file the agent wrote", () => {
  const at = Date.parse("2026-10-25T14:03:11Z");
  assert.equal(change_text({ kind: "created", at }), "created in this chat at 10-25 14:03:11");
  assert.equal(change_text({ kind: "modified", at }), "modified since this chat started at 10-25 14:03:11");
  assert.equal(change_text({ kind: "written", actor: "main", tool: "replace_in_file", at, same_bytes: true, before_chat: true }), "written by main via replace_in_file at 10-25 14:03:11, existed before this chat");
  assert.equal(change_text({ kind: "written", actor: "main", tool: "write_file", at, same_bytes: false, before_chat: true }), "written by main at 10-25 14:03:11, changed on disk since, existed before this chat");
  assert.equal(change_text({ kind: "written", actor: "main", tool: "write_file", at, same_bytes: true, before_chat: false }), "written by main via write_file at 10-25 14:03:11");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { file_link_target } from "../src/state/file-link-rules.ts";

const root = "D:\\Proj";

test("a link inside the chat's folder opens in the Files panel by its folder-relative path", () => {
  assert.deepEqual(file_link_target("docs/report.md", root), { kind: "project", path: "docs/report.md" });
  assert.deepEqual(file_link_target("./notes/a.md", root), { kind: "project", path: "notes/a.md" });
  assert.deepEqual(file_link_target("/src/a.ts", root), { kind: "project", path: "src/a.ts" });
  assert.deepEqual(file_link_target("d:\\proj\\docs\\x.md", root), { kind: "project", path: "docs/x.md" });
  assert.deepEqual(file_link_target("D:%5CProj%5Cdocs%5Cx.md", root), { kind: "project", path: "docs/x.md" });
  assert.deepEqual(file_link_target("file:///D:/Proj/a.md", root), { kind: "project", path: "a.md" });
  assert.deepEqual(file_link_target("/D:/Proj/a.md", root), { kind: "project", path: "a.md" });
  assert.deepEqual(file_link_target("my%20report.md", root), { kind: "project", path: "my report.md" });
});

test("a line or anchor suffix is dropped from the file path", () => {
  assert.deepEqual(file_link_target("src/a.ts:42", root), { kind: "project", path: "src/a.ts" });
  assert.deepEqual(file_link_target("src/a.ts:42:7", root), { kind: "project", path: "src/a.ts" });
  assert.deepEqual(file_link_target("src/a.ts#L10", root), { kind: "project", path: "src/a.ts" });
});

test("a link outside the chat's folder is revealed in Explorer by its absolute path", () => {
  assert.deepEqual(file_link_target("C:\\Users\\x\\Desktop\\b.txt", root), { kind: "outside", path: "C:\\Users\\x\\Desktop\\b.txt" });
  assert.deepEqual(file_link_target("../other/c.md", root), { kind: "outside", path: "D:\\other\\c.md" });
  assert.deepEqual(file_link_target("D:\\Project2\\a.md", root), { kind: "outside", path: "D:\\Project2\\a.md" });
  assert.deepEqual(file_link_target("D:\\Proj", root), { kind: "outside", path: "D:\\Proj" });
  assert.deepEqual(file_link_target("//server/share/a.md", root), { kind: "outside", path: "\\\\server\\share\\a.md" });
});

test("without a chat folder only absolute links resolve", () => {
  assert.equal(file_link_target("docs/report.md", null), null);
  assert.deepEqual(file_link_target("C:/x/y.md", null), { kind: "outside", path: "C:\\x\\y.md" });
  assert.equal(file_link_target("", root), null);
});

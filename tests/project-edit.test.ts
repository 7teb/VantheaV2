import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { commit_edit, max_write_bytes, prepare_replace, prepare_write } from "../electron/project/edit.ts";
import { apply_replacement } from "../electron/project/replace.ts";
import { failure_of } from "../electron/tools/types.ts";

let root = "";

const write = async (relative: string, content: string) => {
  const prepared = await prepare_write(root, relative, content);
  await commit_edit(prepared);
  return prepared;
};

test("commit_edit returns the sha256 of the bytes it wrote", async () => {
  const prepared = await prepare_write(root, "hashed.txt", "hash me\n");
  const sha256 = await commit_edit(prepared);
  assert.equal(sha256, createHash("sha256").update(await fs.readFile(path.join(root, "hashed.txt"))).digest("hex"));
});

const read = (relative: string) => fs.readFile(path.join(root, relative), "utf8");

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-edit-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("write_file creates, nests and overwrites files", async () => {
  const created = await write("calc.py", "print(1)");
  assert.equal(created.previous, null);
  assert.equal(await read("calc.py"), "print(1)");
  await write("src/util/helper.py", "x = 1");
  assert.equal(await read("src/util/helper.py"), "x = 1");
  const overwritten = await write("calc.py", "print(2)\n");
  assert.equal(overwritten.previous, "print(1)");
  assert.deepEqual([overwritten.diff.added, overwritten.diff.removed], [1, 1]);
  await write(".env.example", "KEY=value");
  assert.equal(await read(".env.example"), "KEY=value");
});

test("write_file refuses secrets, oversize content and binary targets", async () => {
  await assert.rejects(prepare_write(root, ".env", "x"), /secret/);
  await assert.rejects(prepare_write(root, "big.txt", "a".repeat(max_write_bytes + 1)), /1 MB/);
  await fs.writeFile(path.join(root, "blob.bin"), Buffer.from([1, 0, 2]));
  await assert.rejects(prepare_write(root, "blob.bin", "text"), /binary/);
});

test("an edit fails when the file changed after it was prepared", async () => {
  await write("race.txt", "one");
  const prepared = await prepare_write(root, "race.txt", "two");
  await fs.writeFile(path.join(root, "race.txt"), "edited by the user");
  await assert.rejects(commit_edit(prepared), /changed on disk/);
  assert.equal(await read("race.txt"), "edited by the user");
});

test("replace_in_file replaces exact matches and checks the count", async () => {
  await write("app.ts", "const a = 1;\nconst b = 1;\n");
  const single = await prepare_replace(root, "app.ts", "const a = 1;", "const a = 2;", 1);
  await commit_edit(single);
  assert.equal(await read("app.ts"), "const a = 2;\nconst b = 1;\n");
  await assert.rejects(prepare_replace(root, "app.ts", "= ", "== ", 1), /occurs 2 times but expected_replacements is 1/);
  const both = await prepare_replace(root, "app.ts", " = ", " := ", 2);
  assert.equal(both.replaced, 2);
  await assert.rejects(prepare_replace(root, "missing.ts", "a", "b", 1), /does not exist; use write_file/);
});

test("replacement falls back to whitespace-flexible matching with precise errors", () => {
  const original = "function f() {\r\n\treturn 1;\r\n}\r\n";
  const flexible = apply_replacement(original, "function f() {\n    return 1;\n}", "function f() {\n  return 2;\n}", 1, "f.ts");
  assert.equal(flexible.flexible, true);
  assert.equal(flexible.updated, "function f() {\r\n  return 2;\r\n}\r\n");
  assert.throws(() => apply_replacement(original, "function g()", "x", 1, "f.ts"), /not found[\s\S]*read_file/);
  assert.throws(() => apply_replacement("a  b\na\tb\n", "a b", "c", 1, "f.ts"), /whitespace-flexible form occurs 2 times but expected_replacements is 1/);
  assert.equal(apply_replacement("x\ta  b", "a b", "c", 1, "f.ts").updated, "x\tc");
  assert.throws(() => apply_replacement("a\tb", "  ", "x", 1, "f.ts"), /only whitespace/);
  assert.throws(() => apply_replacement("ab ab", "a b", "c", 1, "f.ts"), /not found/);
  assert.throws(() => apply_replacement("ab ab", "a b", "c", 1, "f.ts"), (error: unknown) => {
    assert.deepEqual(failure_of(error), { kind: "replace_not_found", path: "f.ts" });
    return true;
  });
  assert.throws(() => apply_replacement("a\tb", "  ", "x", 1, "f.ts"), (error: unknown) => {
    assert.deepEqual(failure_of(error), { kind: "replace_not_found", path: "f.ts" });
    return true;
  });
});

test("exact replacements keep the file's line endings", () => {
  assert.equal(apply_replacement("a\r\nb\r\n", "a", "a\nz", 1, "f.ts").updated, "a\r\nz\r\nb\r\n");
  assert.equal(apply_replacement("a\nb\n", "a", "a\nz", 1, "f.ts").updated, "a\nz\nb\n");
});

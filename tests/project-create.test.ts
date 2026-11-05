import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { folder_name, free_folder } from "../electron/project/create.ts";

test("a project name becomes a valid Windows folder name", () => {
  assert.equal(folder_name("My App"), "My App");
  assert.equal(folder_name('  a<b>c:d"e/f\\g|h?i*j  '), "a b c d e f g h i j");
  assert.equal(folder_name("notes..."), "notes");
  assert.equal(folder_name("trailing space. "), "trailing space");
  assert.equal(folder_name("CON"), "CON project");
  assert.equal(folder_name("lpt3"), "lpt3 project");
  assert.equal(folder_name("<>:?*"), "Project");
  assert.equal(folder_name("tab\there"), "tab here");
});

test("a taken folder name gets the next free number", async () => {
  const parent = path.join("C:", "Users", "x", "Documents", "VantheaX");
  const taken = new Set([path.join(parent, "Demo"), path.join(parent, "Demo 2")]);
  assert.equal(await free_folder(parent, "Demo", async (target) => taken.has(target)), path.join(parent, "Demo 3"));
  assert.equal(await free_folder(parent, "Fresh", async (target) => taken.has(target)), path.join(parent, "Fresh"));
});

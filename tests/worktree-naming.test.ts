import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pick_folder } from "../electron/worktrees/create.ts";
import { branch_slug, free_branch, is_branch_name, worktree_leaf } from "../electron/worktrees/naming.ts";

test("the slug takes the first five words of the message as lowercase ASCII", () => {
  assert.equal(branch_slug("Fix the login-bug in auth.ts please now", "a1b2c3d4"), "fix-the-login-bug-in");
  assert.equal(branch_slug("Größe der Übersicht ändern, bitte!", "a1b2c3d4"), "grosse-der-ubersicht-andern-bitte");
  assert.equal(branch_slug("  Refactor   the  API: v2 ", "a1b2c3d4"), "refactor-the-api-v2");
  assert.equal(branch_slug("Supercalifragilisticexpialidocious extraordinarily", "a1b2c3d4"), "supercalifragilisticexpialidocious-extra");
  assert.equal(branch_slug("Mehr-Sprachen-Unterstützung-für-die-App-einbauen", "a1b2c3d4"), "mehr-sprachen-unterstutzung-fur-die");
});

test("a message without letters or digits names the branch after the folder id", () => {
  assert.equal(branch_slug("", "a1b2c3d4"), "chat-a1b2c3");
  assert.equal(branch_slug("!!! ??? ...", "0f0e0d0c"), "chat-0f0e0d");
  assert.equal(branch_slug("日本語のテキスト", "0f0e0d0c"), "chat-0f0e0d");
});

test("a taken branch name gets a number, case-insensitively and across folder levels", () => {
  assert.equal(free_branch("vx/fix-login", []), "vx/fix-login");
  assert.equal(free_branch("vx/fix-login", ["main", "vx/fix-login"]), "vx/fix-login-2");
  assert.equal(free_branch("vx/fix-login", ["VX/Fix-Login", "vx/fix-login-2"]), "vx/fix-login-3");
  assert.equal(free_branch("vx/fix", ["vx/fix/deeper"]), "vx/fix-2");
  assert.equal(free_branch("vx/fix", ["vx/fix-2/x", "vx/fix"]), "vx/fix-3");
});

test("a branch named like the namespace itself moves the new name out of the namespace", () => {
  assert.equal(free_branch("vx/fix-login", ["vx"]), "vx-fix-login");
  assert.equal(free_branch("vx/fix-login", ["VX", "vx-fix-login"]), "vx-fix-login-2");
});

test("branch names follow the rules git check-ref-format applies", () => {
  for (const name of ["vx/fix-login", "main", "feature/a.b", "vx/chat-a1b2c3"]) {
    assert.equal(is_branch_name(name), true, name);
  }
  for (const name of ["", "-x", "/x", "x/", "x.", "a..b", "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{b", "@", "x/.hidden", "x.lock", "a//b"]) {
    assert.equal(is_branch_name(name), false, name);
  }
});

test("the folder keeps the repository folder name and draws a new id when the folder exists", async () => {
  const root = path.join("C:\\data", "worktrees");
  const ids = ["aaaaaaaa", "bbbbbbbb", "cccccccc"];
  const taken = new Set([path.join(root, "aaaaaaaa"), path.join(root, "bbbbbbbb")]);
  const folder = await pick_folder(root, worktree_leaf("D:\\Projects\\Shop App"), async (dir) => taken.has(dir), () => ids.shift() ?? "dddddddd");
  assert.equal(folder, path.join(root, "cccccccc", "Shop App"));
  assert.equal(worktree_leaf("D:\\Projects\\con"), "con project");
});

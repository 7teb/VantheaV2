import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { is_secret_path } from "../shared/secret-path.ts";
import { resolve_inside, resolve_write_target } from "../electron/project/scope.ts";
import { failure_of } from "../electron/tools/types.ts";
import { git, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";

let root = "";
let outside = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-scope-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "vx-outside-"));
  await fs.writeFile(path.join(root, "calc.py"), "print(1)");
  await fs.writeFile(path.join(outside, "target.txt"), "outside");
  await fs.symlink(outside, path.join(root, "linkdir"), "junction");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await fs.rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("secret paths cover env files, keys, ssh folders and git config", () => {
  for (const secret of [".env", ".env.local", "id_rsa", "cert.pem", "config/secrets.json", ".ssh/known_hosts", ".git/config", "sub/.git/config", "CREDENTIALS.yml", "keys\\server.KEY", "id_rsa.", ".env ", ".git/hooks/pre-commit", "sub/.git/hooks", ".git\\hooks\\post-checkout"]) {
    assert.equal(is_secret_path(secret), true, secret);
  }
  for (const plain of [".env.example", ".env.sample", "src/environment.ts", "docs/keys.md", "git/config"]) {
    assert.equal(is_secret_path(plain), false, plain);
  }
});

test("write targets inside the project resolve to forward-slash relatives", async () => {
  const created = await resolve_write_target(root, "src\\util\\helper.py");
  assert.equal(created.relative, "src/util/helper.py");
  assert.equal(created.exists, false);
  const existing = await resolve_write_target(root, "calc.py");
  assert.equal(existing.exists, true);
  assert.equal((await resolve_write_target(root, ".env.example")).relative, ".env.example");
});

test("write targets reject drive, UNC, absolute, traversal, stream, device and secret paths", async () => {
  const rejected = [
    "C:\\Windows\\evil.txt",
    "..\\..\\evil.txt",
    "../../evil.txt",
    "D:evil.txt",
    "\\\\server\\share\\x.txt",
    "//server/share/x.txt",
    "calc.py:stream",
    "/etc/passwd",
    "nul",
    "logs/con.txt",
    "",
    ".env",
    ".env.local",
    "id_rsa",
    "cert.pem",
    "config/secrets.json",
    ".ssh/known_hosts",
    "a\u0000b",
  ];
  for (const relative of rejected) {
    await assert.rejects(resolve_write_target(root, relative), Error, JSON.stringify(relative));
  }
});

test("write targets never escape through a linked folder or write through a link", async () => {
  await assert.rejects(resolve_write_target(root, "linkdir/escape.txt"), /outside the project/);
  await assert.rejects(resolve_write_target(root, "linkdir"), /symlink/);
  await assert.rejects(resolve_write_target(root, "linkdir/new/deeper.txt"), /outside the project/);
});

test("reads resolve inside the project and explain how to reach outside files", async () => {
  assert.equal((await resolve_inside(root, "calc.py")).relative, "calc.py");
  assert.equal((await resolve_inside(root)).relative, ".");
  await assert.rejects(resolve_inside(root, "../"), /outside the project folder[\s\S]*run_command/);
  await assert.rejects(resolve_inside(root, "linkdir/target.txt"), /outside the project folder/);
  await assert.rejects(resolve_inside(root, "missing.txt"), /does not exist/);
  await assert.rejects(resolve_inside("", "x"), /No project folder/);
  await assert.rejects(resolve_inside(root, "sub\\missing.txt"), (error: unknown) => {
    assert.deepEqual(failure_of(error), { kind: "not_in_project", path: "sub/missing.txt" });
    return true;
  });
  await assert.rejects(resolve_inside(root, "../"), (error: unknown) => {
    assert.deepEqual(failure_of(error), { kind: "outside_project", path: "../" });
    return true;
  });
  await assert.rejects(resolve_write_target(root, "../notes/0.4.0.md"), (error: unknown) => {
    assert.deepEqual(failure_of(error), { kind: "outside_project", path: "../notes/0.4.0.md" });
    return true;
  });
});

test("a worktree reads the main project's node_modules through its junction but never writes through it", { skip: skip_without_git }, async () => {
  const main = await repo_with("scope-main", { ".gitignore": "node_modules/\n", "a.txt": "a" });
  await write(main, { "node_modules/pkg/index.d.ts": "export {};" });
  const tree = path.join(await scratch("scope-tree"), "copy");
  git(main, "worktree", "add", "-q", "-b", "vx/scope", tree);
  await fs.symlink(path.join(main, "node_modules"), path.join(tree, "node_modules"), "junction");
  const read = await resolve_inside(tree, "node_modules/pkg/index.d.ts");
  assert.equal(read.relative, "node_modules/pkg/index.d.ts");
  assert.equal(read.target, path.join(main, "node_modules", "pkg", "index.d.ts"));
  assert.equal((await resolve_inside(tree, "node_modules")).relative, "node_modules");
  await assert.rejects(resolve_write_target(tree, "node_modules/pkg/new.js"), /links out of the project/);
  const other = path.join(await scratch("scope-other"), "copy");
  git(main, "worktree", "add", "-q", "-b", "vx/other", other);
  await fs.symlink(outside, path.join(other, "node_modules"), "junction");
  await assert.rejects(resolve_inside(other, "node_modules/target.txt"), /outside the project folder/);
  await fs.symlink(path.join(main, "node_modules"), path.join(root, "node_modules"), "junction");
  await assert.rejects(resolve_inside(root, "node_modules/pkg/index.d.ts"), /outside the project folder/);
});

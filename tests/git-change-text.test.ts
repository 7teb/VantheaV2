import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { collect_change_text } from "../electron/git/change-text.ts";
import { git, repo_with, scratch, skip_without_git, write } from "./git-kit.ts";
import { access_of, identity_config } from "./git-write-kit.ts";

const options = { skip: skip_without_git };

const room = 1_000_000;

before(async () => {
  if (!skip_without_git) await identity_config();
});

const working = async (root: string, budget = room) => collect_change_text(await access_of(root), { kind: "working" }, budget);

test("the working text lists every file, shows text diffs and new files, and keeps secret and binary content out", options, async () => {
  const root = await repo_with("text-working", { "a.ts": "const a = 1;\n", "config/.env.prod": "KEY=old\n", "logo.png": "\u0000PNG" });
  await write(root, { "a.ts": "const a = 2;\n", "config/.env.prod": "KEY=secret-value\n", "notes.md": "# Notes\nhello\n", ".npmrc": "//registry:_authToken=abc\n", "img.bin": "\u0000\u0001binary" });
  await fs.writeFile(path.join(root, "logo.png"), Buffer.from([0, 1, 2, 3]));
  git(root, "commit", "-q", "--allow-empty", "-m", "Add the parser");
  const text = await working(root);
  assert.match(text, /Latest commit subjects:\nAdd the parser\ninit/);
  assert.match(text, /a\.ts \+1 -1/);
  assert.match(text, /-const a = 1;\n\+const a = 2;/);
  assert.match(text, /notes\.md \(new file\)/);
  assert.match(text, /\+# Notes\n\+hello/);
  assert.match(text, /config\/\.env\.prod \(secret file, content not shown\)/);
  assert.match(text, /\.npmrc \(secret file, content not shown\)/);
  assert.match(text, /logo\.png \+0 -0 \(binary\)|logo\.png.*\(binary\)/);
  assert.match(text, /img\.bin \(binary\)/);
  assert.doesNotMatch(text, /secret-value|_authToken|KEY=old/);
});

test("files that do not fit the room are named with their counts, the smaller ones keep their diff", options, async () => {
  const root = await repo_with("text-room", { "small.txt": "s\n", "big.txt": "b\n" });
  await write(root, { "small.txt": "s2\n", "big.txt": [...Array(4000).keys()].map((index) => `line ${index} of the big file`).join("\n") });
  const text = await working(root, 600);
  assert.match(text, /small\.txt \+1 -1\n/);
  assert.match(text, /\+s2/);
  assert.match(text, /big\.txt \+4000 -1 \(diff left out for size\)/);
  assert.doesNotMatch(text, /line 3999 of the big file/);
});

test("a repository without commits sends every file as new", options, async () => {
  const root = await scratch("text-unborn");
  git(root, "init", "-q", "-b", "main");
  await write(root, { "a.txt": "first\n", "src/b.txt": "second\n" });
  git(root, "add", "a.txt");
  const text = await working(root);
  assert.match(text, /^This is the first commit of the repository\./);
  assert.match(text, /a\.txt \(new file\)/);
  assert.match(text, /src\/b\.txt \(new file\)/);
  assert.match(text, /\+first/);
  assert.match(text, /\+second/);
});

test("a subfolder project only describes its own files", options, async () => {
  const root = await repo_with("text-sub", { "app/a.txt": "a\n", "other/o.txt": "o\n" });
  await write(root, { "app/a.txt": "a2\n", "other/o.txt": "o2\n", "app/n.txt": "n\n" });
  const text = await working(path.join(root, "app"));
  assert.match(text, /a\.txt \+1 -1/);
  assert.match(text, /n\.txt \(new file\)/);
  assert.doesNotMatch(text, /o\.txt|o2/);
});

test("the branch text holds the branch commits and the diff against the merge base, not later base commits", options, async () => {
  const root = await repo_with("text-branch", { "a.txt": "a\n", "base.txt": "base\n" });
  git(root, "checkout", "-q", "-b", "feature");
  await write(root, { "a.txt": "feature change\n" });
  git(root, "commit", "-q", "-am", "Change a on the branch", "-m", "Because a was wrong.");
  git(root, "checkout", "-q", "main");
  await write(root, { "base.txt": "later on main\n" });
  git(root, "commit", "-q", "-am", "Later main commit");
  git(root, "checkout", "-q", "feature");
  await write(root, { "uncommitted.txt": "not part of the branch\n" });
  const text = await collect_change_text(await access_of(root), { kind: "branch", base_ref: "main" }, room);
  assert.match(text, /^Commits of this branch:\nChange a on the branch\n\nBecause a was wrong\./);
  assert.match(text, /\+feature change/);
  assert.doesNotMatch(text, /later on main|Later main commit|uncommitted/);
});

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { read_operation } from "../electron/git/operation.ts";
import { first_view, git, git_status, repo_with, skip_without_git, write } from "./git-kit.ts";

const options = { skip: skip_without_git };

const diverged = async (prefix: string): Promise<string> => {
  const root = await repo_with(prefix, { "both.txt": "base\n", "other.txt": "o\n" });
  git(root, "checkout", "-q", "-b", "side");
  await write(root, { "both.txt": "side\n" });
  git(root, "commit", "-q", "-am", "side change");
  git(root, "checkout", "-q", "main");
  await write(root, { "both.txt": "main\n" });
  git(root, "commit", "-q", "-am", "main change");
  return root;
};

test("a merge with a conflict shows the merge and a UU entry", options, async () => {
  const root = await diverged("op-merge");
  assert.notEqual(git_status(root, "merge", "side"), 0);
  const view = await first_view(root);
  assert.equal(view.kind, "repo");
  if (view.kind !== "repo") return;
  assert.deepEqual(view.operation, { kind: "merge", step: null, total: null, branch: null });
  assert.deepEqual(view.entries.map((entry) => [entry.path, entry.status, entry.conflict]), [["both.txt", "conflicted", "UU"]]);
});

test("a rebase that stops on a conflict shows step, total and the branch being rebased", options, async () => {
  const root = await diverged("op-rebase");
  git(root, "checkout", "-q", "side");
  await write(root, { "extra.txt": "e\n" });
  git(root, "add", "extra.txt");
  git(root, "commit", "-q", "-m", "second side change");
  assert.notEqual(git_status(root, "rebase", "main"), 0);
  const view = await first_view(root);
  assert.equal(view.kind, "repo");
  if (view.kind !== "repo") return;
  assert.deepEqual(view.operation, { kind: "rebase", step: 1, total: 2, branch: "side" });
  assert.equal(view.branch.name, null);
  assert.ok(view.entries.some((entry) => entry.status === "conflicted"));
});

test("a cherry-pick with a conflict and a bisect are recognised from their files", options, async () => {
  const root = await diverged("op-pick");
  assert.notEqual(git_status(root, "cherry-pick", "side"), 0);
  assert.deepEqual(await read_operation(path.join(root, ".git")), { kind: "cherry_pick", step: null, total: null, branch: null });
  git(root, "cherry-pick", "--abort");
  assert.equal(await read_operation(path.join(root, ".git")), null);
  git(root, "bisect", "start");
  assert.deepEqual(await read_operation(path.join(root, ".git")), { kind: "bisect", step: null, total: null, branch: null });
  git(root, "bisect", "reset");
});

test("a revert with a conflict is recognised", options, async () => {
  const root = await repo_with("op-revert", { "f.txt": "one\n" });
  await write(root, { "f.txt": "two\n" });
  git(root, "commit", "-q", "-am", "two");
  await write(root, { "f.txt": "three\n" });
  git(root, "commit", "-q", "-am", "three");
  assert.notEqual(git_status(root, "revert", "--no-edit", "HEAD~1"), 0);
  assert.equal((await read_operation(path.join(root, ".git")))?.kind, "revert");
});

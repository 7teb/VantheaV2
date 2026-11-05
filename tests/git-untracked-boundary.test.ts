import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { collect_change_text } from "../electron/git/change-text.ts";
import { read_guard } from "../electron/git/guard.ts";
import { detect_repo } from "../electron/git/repo.ts";
import { exec_git } from "../electron/git/run.ts";
import { access_of, identity_config } from "./git-write-kit.ts";
import { git, repo_with, scratch, tool, write } from "./git-kit.ts";

test("a directory replaced immediately before reading cannot leak external contents", async (t) => {
  const root = await repo_with("final-link-race", { "base.txt": "base" });
  const external = await scratch("final-link-private");
  await write(root, { "local/file.txt": "local content" });
  await write(external, { "file.txt": "AFTER_LAST_CHECK_EXTERNAL" });
  const access = await access_of(root);
  const read = fs.readFile;
  const open = fs.open;
  const local = path.join(root, "local");
  const held = path.join(root, "held");
  assert.equal(path.dirname(local), root);
  assert.equal(path.dirname(held), root);
  let swapped = false;
  const swap = async (file: unknown) => {
    if (!swapped && String(file) === path.join(local, "file.txt")) {
      swapped = true;
      await fs.rename(local, held);
      await fs.symlink(external, local, "junction");
    }
  };
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    await swap(args[0]);
    return Reflect.apply(open, fs, args);
  });
  t.mock.method(fs, "readFile", async (file: Parameters<typeof fs.readFile>[0], ...args: unknown[]) => {
    await swap(file);
    return Reflect.apply(read, fs, [file, ...args]);
  });
  const text = await collect_change_text(access, { kind: "working" }, 100000);
  assert.equal(swapped, true);
  assert.ok(!text.includes("AFTER_LAST_CHECK_EXTERNAL"), text);
});

test("a legitimate project-root junction retains local untracked contents", async () => {
  const root = await repo_with("root-alias", { "base.txt": "base" });
  await write(root, { "local.txt": "VALID_LOCAL_CONTENT" });
  const alias = path.join(await scratch("root-alias-holder"), "project");
  await fs.symlink(root, alias, "junction");
  const text = await collect_change_text(await access_of(alias), { kind: "working" }, 100000);
  assert.ok(text.includes("VALID_LOCAL_CONTENT"), text);
});

test("a submodule process filter cannot suppress the trusted clean-only parent filter", async () => {
  const global = await identity_config();
  const source = await repo_with("clean-child", { ".gitattributes": "*.txt filter=medium\n", "child.txt": "working\n" });
  const root = await repo_with("clean-parent", { ".gitattributes": "*.txt filter=medium\n", "file.txt": "working\n" });
  git(root, "submodule", "add", "-q", source, "sub");
  git(root, "commit", "-qm", "add submodule");
  const marker = path.join(root, "child-filter-ran");
  git(root, "config", "--file", path.join(root, ".git", "modules", "sub", "config"), "filter.medium.process", `sh -c 'echo child > "${marker.replaceAll("\\", "/")}"; exit 1'`);
  await fs.appendFile(global, '\n[filter "medium"]\n\tclean = sed s/working/stored/g\n');
  const detected = await detect_repo(tool(), root);
  assert.equal(detected.kind, "repo");
  if (detected.kind !== "repo") return;
  const guarded = await read_guard(tool(), detected.paths, null);
  const args = ["hash-object", "--path=file.txt", "file.txt"];
  const expected = await exec_git(tool(), { cwd: root, args });
  const actual = await exec_git(tool(), { cwd: root, args, config: guarded.read_config });
  assert.equal(expected.code, 0, expected.stderr);
  assert.equal(actual.code, 0, actual.stderr);
  assert.equal(actual.stdout.toString(), expected.stdout.toString());
  const child = await exec_git(tool(), { cwd: path.join(root, "sub"), args: ["hash-object", "--path=child.txt", "child.txt"], config: guarded.read_config });
  assert.equal(child.code, 0, child.stderr);
  assert.equal(await fs.access(marker).then(() => true, () => false), false);
});

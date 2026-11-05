import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { find_git_exe, locate_git, minimum_git, parse_git_version, partial_clone_git, recheck_git, version_at_least, type GitLocateProbe, type GitStamp } from "../electron/git/locate.ts";
import { real_git, scratch, skip_without_git, write } from "./git-kit.ts";

const fake_probe = (overrides: Partial<GitLocateProbe>): GitLocateProbe & { versions: string[] } => {
  const versions: string[] = [];
  return {
    versions,
    install_path: async () => null,
    exists: fs.existsSync,
    env: {},
    stamp: () => ({ mtime_ms: 1, size: 1 }),
    run: async (exe, args) => {
      if (args[0] === "--version") {
        versions.push(exe);
        return "git version 2.50.1.windows.1\n";
      }
      return "GIT_DIR\nGIT_WORK_TREE\n";
    },
    ...overrides,
  };
};

test("the Git for Windows install from the registry wins over git.exe on PATH", async () => {
  const install = await scratch("locate-install");
  const other = await scratch("locate-path");
  await write(install, { "bin/bash.exe": "", "usr/bin/bash.exe": "", "cmd/git.exe": "" });
  await write(other, { "git.exe": "" });
  const probe = fake_probe({ install_path: async (key) => (key.startsWith("HKLM") ? install : null), env: { Path: other } });
  const found = await locate_git(probe);
  assert.equal(found.kind, "found");
  assert.equal(found.kind === "found" ? found.tool.exe : "", path.win32.join(install, "cmd", "git.exe"));
  assert.deepEqual(found.kind === "found" ? found.tool.local_env : [], ["GIT_DIR", "GIT_WORK_TREE"]);
});

test("the PATH search skips relative entries, so a git.exe next to the working directory is never picked", async () => {
  const probe = fake_probe({
    env: { PATH: '.;tools\\bin;"C:\\Tools\\Git\\cmd"' },
    exists: (file) => !path.win32.isAbsolute(file) || file === "C:\\Tools\\Git\\cmd\\git.exe",
  });
  assert.equal(await find_git_exe(probe), "C:\\Tools\\Git\\cmd\\git.exe");
  assert.equal(await find_git_exe(fake_probe({ env: { PATH: ".;bin" }, exists: () => true })), null);
});

test("without any git.exe the result is missing, and missing searches again on the next check", async () => {
  let present = false;
  const dir = await scratch("locate-later");
  const exe = path.win32.join(dir, "git.exe");
  const probe = fake_probe({ env: { PATH: dir }, exists: (file) => present && file === exe });
  const missing = await locate_git(probe);
  assert.deepEqual(missing, { kind: "missing" });
  present = true;
  const again = recheck_git(probe, missing, minimum_git, false);
  assert.ok(again);
  assert.equal((await again)?.kind, "found");
});

test("a focus recheck for a missing git checks files only, a full recheck reads the registry too", async () => {
  const install = await scratch("locate-registry");
  await write(install, { "bin/bash.exe": "", "usr/bin/bash.exe": "", "cmd/git.exe": "" });
  const keys: string[] = [];
  const probe = fake_probe({
    install_path: async (key) => {
      keys.push(key);
      return key.startsWith("HKLM") ? install : null;
    },
  });
  assert.deepEqual(await recheck_git(probe, { kind: "missing" }, minimum_git, false), { kind: "missing" });
  assert.deepEqual(keys, []);
  const found = await recheck_git(probe, { kind: "missing" }, minimum_git, true);
  assert.equal(found?.kind === "found" ? found.tool.exe : "", path.win32.join(install, "cmd", "git.exe"));
  assert.deepEqual(keys, ["HKLM\\SOFTWARE\\GitForWindows"]);
});

test("a too old git runs --version again only after its size or time changed", async () => {
  const dir = await scratch("locate-old");
  await write(dir, { "git.exe": "" });
  let stamp: GitStamp = { mtime_ms: 10, size: 100 };
  const probe = fake_probe({
    env: { PATH: dir },
    stamp: () => stamp,
    run: async (_exe, args) => {
      if (args[0] === "--version") probe.versions.push("run");
      return args[0] === "--version" ? "git version 2.30.1.windows.1\n" : "GIT_DIR\n";
    },
  });
  const old = await locate_git(probe);
  assert.equal(old.kind === "found" ? old.tool.version : "", "2.30.1");
  assert.equal(probe.versions.length, 1);
  assert.equal(recheck_git(probe, old, minimum_git, false), null);
  assert.equal(recheck_git(probe, old, minimum_git, false), null);
  assert.equal(probe.versions.length, 1);
  stamp = { mtime_ms: 20, size: 100 };
  await recheck_git(probe, old, minimum_git, false);
  assert.equal(probe.versions.length, 2);
});

test("a git new enough for the minimum is rechecked for partial clones the same way", async () => {
  const dir = await scratch("locate-partial");
  await write(dir, { "git.exe": "" });
  const probe = fake_probe({ env: { PATH: dir }, run: async (_exe, args) => (args[0] === "--version" ? "git version 2.40.1\n" : "") });
  const found = await locate_git(probe);
  assert.equal(recheck_git(probe, found, minimum_git, false), null);
  assert.equal(recheck_git(probe, found, partial_clone_git, false), null);
  assert.ok(found.kind === "found" && !version_at_least(found.tool.numbers, partial_clone_git));
});

test("version text parses and compares by number", () => {
  assert.deepEqual(parse_git_version("git version 2.54.0.windows.1"), [2, 54, 0]);
  assert.equal(parse_git_version("not git"), null);
  assert.equal(version_at_least([2, 33, 0], minimum_git), true);
  assert.equal(version_at_least([2, 32, 9], minimum_git), false);
  assert.equal(version_at_least([3, 0, 0], partial_clone_git), true);
  assert.equal(version_at_least([2, 44, 99], partial_clone_git), false);
});

test("the real git is found with an absolute path and its local environment list", { skip: skip_without_git }, () => {
  assert.ok(real_git);
  assert.ok(path.win32.isAbsolute(real_git.exe), real_git.exe);
  assert.match(path.win32.basename(real_git.exe), /^git\.exe$/i);
  assert.ok(real_git.local_env.includes("GIT_DIR"));
  assert.ok(version_at_least(real_git.numbers, minimum_git));
});

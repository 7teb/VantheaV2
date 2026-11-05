import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { walk_command, type Step } from "../electron/permissions/command-walk.ts";
import { command_targets } from "../electron/permissions/target-facts.ts";

let root = "";

const msys = (folder: string) => `/${folder[0]?.toLowerCase()}${folder.slice(2).replace(/\\/g, "/")}`;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-bash-targets-"));
  await fs.mkdir(path.join(root, "sub"));
  await fs.writeFile(path.join(root, "sub", "a.txt"), "a");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const paths = async (command: string) => (await command_targets(command, root, [], process.env, "posix")).targets.map((target) => target.path);

test("MSYS drive paths in bash arguments become Windows target paths and /dev/null is no target", async () => {
  const found = await paths(`cat ${msys(path.join(root, "sub", "a.txt"))} /dev/null`);
  assert.deepEqual(found, [path.join(root, "sub", "a.txt")]);
  assert.deepEqual(await paths("cat C:/Windows/win.ini"), ["C:\\Windows\\win.ini"]);
});

test("cd with an MSYS path, a brace group and doubled switches resolve like bash runs them", async () => {
  assert.deepEqual(await paths(`cd ${msys(path.join(root, "sub"))} && cat a.txt`), [path.join(root, "sub"), path.join(root, "sub", "a.txt")]);
  assert.deepEqual(await paths("{ cd sub; cat a.txt; }"), [path.join(root, "sub"), path.join(root, "sub", "a.txt")]);
  assert.deepEqual(await paths("taskkill //F //PID 1234"), []);
});

test("the bash walker tracks cd into MSYS paths and the home folder", () => {
  const locations = (command: string) =>
    [...walk_command(command, { location: root, dialect: "posix", env: process.env })].map((step: Step) => ("values" in step.location ? step.location.values[0] : step.location.unresolved));
  assert.deepEqual(locations(`cd ${msys(path.join(root, "sub"))}; ls`).at(-1), path.join(root, "sub"));
  const home = process.env.HOME || process.env.USERPROFILE || "";
  assert.deepEqual(locations("cd; ls").at(-1), path.win32.resolve(home));
  assert.match(String(locations("cd -; ls").at(-1)), /working directory unknown after: cd -/);
});

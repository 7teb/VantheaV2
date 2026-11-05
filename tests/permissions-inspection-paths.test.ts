import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture, sent_text } from "./sources-fixture.ts";
import path from "node:path";
import { floor_reason } from "../electron/permissions/floor.ts";
import { expand_entry, local_imports } from "../electron/permissions/script-loads.ts";

const roots: string[] = [];
after(async () => { for (const root of roots) await fs.rm(root, { recursive: true, force: true }); });

for (const [name, command, phase] of [
  ["unique stop abbreviation", "npm sto", "stop"],
  ["unique run-script abbreviation", "npm run- lint", "lint"],
  ["test alias cache after ignored hooks", "npm --ignore-scripts t; npm t", "pretest"],
  ["install-test alias cache after ignored hooks", "npm --ignore-scripts it; npm it", "install"],
] as const) test(`independently checks ${name}`, async () => {
  const root = await fixture({
    "package.json": JSON.stringify({ scripts: { lint: "node lint.js", stop: "node stop.js", pretest: "node pretest.js", test: "node test.js", install: "node install.js" } }),
    "lint.js": "console.log('REVIEW-lint')", "stop.js": "console.log('REVIEW-stop')", "pretest.js": "console.log('REVIEW-pretest')", "test.js": "console.log('REVIEW-test')", "install.js": "console.log('REVIEW-install')",
  });
  roots.push(root);
  assert.ok(sent_text(await inspect_command_sources(root, root, command)).includes(`REVIEW-${phase}`), command);
});

test("unrelated absolute pipeline sources remain allowed from a system cwd", () => {
  const scope = { cwd: "C:/Windows", project_root: "D:/project", app_root: "" };
  for (const command of ["Get-Item D:/project/out.txt | Remove-Item", "Get-ChildItem D:/project -File | Remove-Item", "Write-Output D:/project/out.txt | Remove-Item"]) {
    assert.equal(floor_reason(command, scope), "", command);
  }
});

test("normalized relative targets and later locations agree with execution order", () => {
  const scope = { cwd: "C:/Windows/System32", project_root: "D:/project", app_root: "" };
  assert.ok(floor_reason("Remove-Item ..\\..\\Windows\\System32 -Recurse", scope));
  assert.equal(floor_reason("Set-Location D:/project; Remove-Item .\\Windows -Recurse", scope), "");
});

test("a comma in a quoted relative .NET argument remains part of the path", () => {
  const scope = { cwd: "C:/project", project_root: "C:/project", app_root: "" };
  assert.ok(floor_reason("[IO.File]::Delete('..\\dummy,dir\\..\\Windows\\file')", scope));
});

test("absolute charset globs match the same exact set as relative glob entries", async () => {
  const root = await fixture({ "scripts/a1.py": "pass", "scripts/b2.py": "pass", "scripts/c3.py": "pass", "scripts/sub/a1.py": "pass" });
  roots.push(root);
  const relative = await expand_entry("scripts/[ab]?.py", root);
  const absolute = await expand_entry(path.join(root, "scripts", "[ab]?.py"), root);
  assert.equal(relative?.files.length, 2);
  assert.deepEqual(absolute, relative);
});

test("relative globs preserve literal bracket characters in the project directory", async () => {
  const root = await fixture({ "[scope]/scripts/a.py": "pass" });
  roots.push(root);
  const found = await expand_entry("scripts/*.py", path.join(root, "[scope]"));
  assert.deepEqual(found?.files, [path.join(root, "[scope]", "scripts", "a.py")]);
});

test("mixed comment-looking literals retain real imports across CRLF boundaries", async () => {
  const root = await fixture({ "dep.js": "export default 1", "dep.py": "pass" });
  roots.push(root);
  const js = await local_imports('const url = "https://host/a/*?x=//";\r\nimport "./dep.js";', path.join(root, "main.js"), root);
  assert.deepEqual(js.files, [path.join(root, "dep.js")]);
  const python = await local_imports('path = r"C:\\#data"; import dep\r\n# import missing', path.join(root, "main.py"), root);
  assert.deepEqual(python.files, [path.join(root, "dep.py")]);
});

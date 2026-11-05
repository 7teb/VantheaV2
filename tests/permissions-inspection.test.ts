import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { floor_reason } from "../electron/permissions/floor.ts";
import { system_delete_reason } from "../electron/permissions/floor-shared.ts";
import { expand_entry, local_imports } from "../electron/permissions/script-loads.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture, sent_text } from "./sources-fixture.ts";

const roots: string[] = [];
const setup = async (files: Record<string, string>) => {
  const root = await fixture(files);
  roots.push(root);
  return root;
};
after(async () => { for (const root of roots) await fs.rm(root, { recursive: true, force: true }); });

for (const [cwd, command] of [
  ["C:/", "Remove-Item .\\Windows -Recurse"],
  ["C:/Windows/System32", "Remove-Item .. -Recurse"],
  ["C:/Windows/System32", "Remove-Item . -Recurse"],
  ["D:/project", "Set-Location C:/; Remove-Item Windows -Recurse"],
  ["C:/", "$target = '.\\Windows'; Remove-Item $target -Recurse"],
  ["C:/Windows", "Get-Item . | Remove-Item -Recurse"],
  ["C:/", "Write-Output .\\Windows | Remove-Item -Recurse"],
  ["C:/Windows", "[IO.Directory]::Delete('.', $true)"],
  ["C:/Windows", "[System.IO.File]::Delete('win.ini')"],
  ["C:/Windows", "$target = 'System32'; [IO.Directory]::Delete($target, $true)"],
] as const) test(`resolves system targets at ${cwd} for ${command}`, () => {
  assert.equal(floor_reason(command, { cwd, project_root: "D:/project", app_root: "" }), system_delete_reason);
});

test("keeps project-relative deletes and reads allowed", () => {
  for (const command of ["Remove-Item .\\Windows -Recurse", "Remove-Item .\\out -Recurse", "Get-Item . | Remove-Item", "Get-Content C:/Windows/win.ini"]) {
    assert.equal(floor_reason(command, { cwd: "D:/project", project_root: "D:/project", app_root: "" }), "", command);
  }
});

for (const command of ["yarn lint", "pnpm lint", "yarn --cwd . lint", "pnpm -C . lint", "npm t", "npm tst", "npm tes", "npm stop", "npm rum lint", "npm urn lint", "npm run-s lint"]) test(`inspects ${command}`, async () => {
  const root = await setup({ "package.json": JSON.stringify({ scripts: { lint: "node task.js", test: "node task.js", stop: "node task.js" } }), "task.js": "console.log('inspected-package-marker')" });
  const sources = await inspect_command_sources(root, root, command);
  assert.match(sent_text(sources), /inspected-package-marker/);
});

for (const [manager, name] of [["yarn", "deploy"], ["pnpm", "unplug"], ["yarn", "CaseSensitive"], ["pnpm", "CaseSensitive"]] as const) test(`preserves manager-specific shortcut ${manager} ${name}`, async () => {
  const root = await setup({ "package.json": JSON.stringify({ scripts: { [name]: "node task.js" } }), "task.js": "console.log('manager-specific-marker')" });
  assert.match(sent_text(await inspect_command_sources(root, root, `${manager} ${name}`)), /manager-specific-marker/);
});

for (const verb of ["it", "cit", "sit", "install-test", "install-ci-test", "clean-install-test"]) test(`install/test alias ${verb} inspects both script phases`, async () => {
  const root = await setup({ "package.json": JSON.stringify({ scripts: { install: "node install.js", test: "node test.js" } }), "install.js": "console.log('install-marker')", "test.js": "console.log('test-marker')" });
  const sources = sent_text(await inspect_command_sources(root, root, `npm ${verb}`));
  assert.match(sources, /install-marker/);
  assert.match(sources, /test-marker/);
});

test("built-in manager commands do not accidentally run same-named package scripts", async () => {
  const root = await setup({ "package.json": JSON.stringify({ scripts: { list: "node task.js", deploy: "node task.js", unplug: "node task.js" } }), "task.js": "console.log('should-not-run-marker')" });
  for (const command of ["yarn list", "yarn unplug", "pnpm list", "pnpm deploy"]) assert.doesNotMatch(sent_text(await inspect_command_sources(root, root, command)), /should-not-run-marker/, command);
});

test("install/test aliases retain their test phase after a previous plain install", async () => {
  const root = await setup({ "package.json": JSON.stringify({ scripts: { install: "node install.js", test: "node test.js" } }), "install.js": "console.log('install-marker')", "test.js": "console.log('test-marker')" });
  assert.match(sent_text(await inspect_command_sources(root, root, "npm install; npm it")), /test-marker/);
});

test("absolute and relative globs discover identical files", async () => {
  const root = await setup({ "scripts/first.py": "print(1)", "scripts/second.py": "print(2)", "scripts/nested/third.py": "print(3)", "scripts/other.txt": "data" });
  const relative = await expand_entry("scripts/**/*.py", root);
  for (const pattern of [path.join(root, "scripts", "**", "*.py"), path.join(root, "scripts", "**", "*.py").replaceAll("\\", "/")]) {
    const absolute = await expand_entry(pattern, root);
    assert.equal(relative?.files.length, 3);
    assert.deepEqual(absolute, relative, pattern);
  }
});

for (const [language, body, file] of [
  ["js", 'const marker = "a/*"; import "./payload.js";', "main.js"],
  ["js", 'const marker = "x // y"; import "./payload.js";', "main.js"],
  ["python", 'marker = "#"; import payload', "main.py"],
] as const) test(`preserves imports following comment characters inside ${language} strings`, async () => {
  const root = await setup({ "payload.js": "console.log(1)", "payload.py": "print(1)" });
  const found = await local_imports(body, path.join(root, file), root, language);
  assert.equal(found.files.length, 1, body);
  assert.equal(path.basename(found.files[0] ?? ""), language === "js" ? "payload.js" : "payload.py");
});

test("ignores genuine commented imports while retaining division and regex literals", async () => {
  const root = await setup({ "payload.js": "console.log(1)", "payload.py": "print(1)" });
  const js = await local_imports('/* import "./missing.js"; */ const re = /a\\/\\/*/; import "./payload.js"; // import "./missing2.js";', path.join(root, "main.js"), root);
  assert.deepEqual(js.files, [path.join(root, "payload.js")]);
  const python = await local_imports('x = 5 // 2; import payload # import missing', path.join(root, "main.py"), root);
  assert.deepEqual(python.files, [path.join(root, "payload.py")]);
});

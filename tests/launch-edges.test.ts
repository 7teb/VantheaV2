import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, shell: "powershell" | "cmd" = "powershell") =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-launch", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env, shell });

test("built-in cmdlets and aliases need no PATH lookup, an alias that shadows a PATH program is a fact", async () => {
  const setup = await fixture_env({ "env.ps1": "$env:PATH = \"$(Get-Location);$env:PATH\"\nTest-Path x\nCopy-Item a b\nWrite-Verbose v" });
  await fs.writeFile(path.join(setup.bin, "rm.exe"), native_bytes());
  const dotted = await inspect(setup, ". .\\env.ps1; Get-ChildItem; tool");
  assert.deepEqual(dotted.gaps, ["Launch target could not be resolved: tool (PATH changed to an unresolved value)"]);
  const alias = await inspect(setup, "rm -r -fo build");
  assert.deepEqual(fact_rows(alias), [["rm", "", "Remove-Item", "builtin"]]);
  const plain = await inspect(setup, "Remove-Item build -Recurse");
  assert.deepEqual(plain.programs, []);
});

test("interpreter options with values are skipped and abbreviated powershell switches are understood", async () => {
  const setup = await fixture_env({ "tools/a.py": "print(1)", "tools/a.ps1": "Write-Output a", "scripts/gen.mjs": "console.log(1)" });
  for (const command of ["python -X utf8 tools\\a.py", "python -W ignore tools\\a.py", "node --env-file .env scripts\\gen.mjs", "powershell -NoProfile -Exec Bypass -File .\\tools\\a.ps1", "powershell -nop -w hidden -File .\\tools\\a.ps1", "powershell /File .\\tools\\a.ps1", "powershell -Version 5.1 -File .\\tools\\a.ps1"]) {
    const sources = await inspect(setup, command);
    assert.deepEqual(sources.gaps, [], command);
    assert.equal(sources.files.filter((file) => file.role === "started").length, 1, command);
  }
  const loader = await inspect(setup, "node --loader ./scripts/gen.mjs scripts\\gen.mjs");
  assert.deepEqual(loader.gaps, []);
});

test("Start-Job and Invoke-Command -FilePath start the script", async () => {
  const setup = await fixture_env({ "tools/a.ps1": "Write-Output job-marker" });
  for (const command of ["Start-Job -FilePath .\\tools\\a.ps1 | Receive-Job -Wait", "Invoke-Command -FilePath .\\tools\\a.ps1 -ComputerName localhost"]) {
    const sources = await inspect(setup, command);
    assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["tools/a.ps1", "started"]], command);
  }
});

test("a FileSystem provider path is launched as a file and other provider paths are gaps", async () => {
  const setup = await fixture_env({ "tools/x.bat": "@echo x" });
  const file = await inspect(setup, "Start-Process FileSystem::.\\tools\\x.bat");
  assert.deepEqual(file.files.map((entry) => [entry.path, entry.role]), [["tools/x.bat", "started"]]);
  const registry = await inspect(setup, "Start-Process Registry::HKCU\\x");
  assert.deepEqual(registry.gaps, ["Launch target could not be resolved: Registry::HKCU\\x (provider path)"]);
});

test("an executable name in an unresolved folder is a fact, any other unresolved target stays a gap", async () => {
  const setup = await fixture_env({ "build.ps1": "param($Configuration)\n& \"$PSScriptRoot\\x64\\$Configuration\\probe.exe\"\n& \"$PSScriptRoot\\x64\\$Configuration\\probe.ps1\"" });
  const sources = await inspect(setup, ".\\build.ps1 -Configuration Release");
  assert.deepEqual(sources.gaps, ['Launch target could not be resolved: "$PSScriptRoot\\x64\\$Configuration\\probe.ps1" (function parameter)']);
  assert.deepEqual(fact_rows(sources), [['"$PSScriptRoot\\x64\\$Configuration\\probe.exe"', "folder not resolved: function parameter", "probe.exe", "unresolved_folder"]]);
});

test("an extensionless interpreter entry that exists is started with the interpreter's language", async () => {
  const setup = await fixture_env({ "bin/www": "require('../app')\n", "app.js": "module.exports = 1\n", "package.json": JSON.stringify({ scripts: { start: "node ./bin/www" } }), "tools/run": "import helper\n", "tools/helper.py": "x = 1\n" });
  const npm = await inspect(setup, "npm start");
  assert.deepEqual(npm.gaps, []);
  assert.deepEqual(npm.files.map((file) => [file.path, file.role]), [["package.json", "manifest"], ["bin/www", "started"], ["app.js", "loaded"]]);
  const python = await inspect(setup, "python tools\\run");
  assert.deepEqual(python.files.map((file) => [file.path, file.role]), [["tools/run", "started"], ["tools/helper.py", "loaded"]]);
  const missing = await inspect(setup, "node tools\\absent");
  assert.deepEqual(missing.gaps, ["Interpreter entry source could not be resolved: tools\\absent"]);
});

test("npm install runs the lifecycle scripts, --ignore-scripts skips them, and pip install -e reads setup.py", async () => {
  const setup = await fixture_env({ "package.json": JSON.stringify({ scripts: { postinstall: "node scripts/setup.mjs", build: "node scripts/build.mjs" } }), "scripts/setup.mjs": "console.log('setup-marker')", "setup.py": "print('setup-py-marker')" });
  const install = await inspect(setup, "npm install");
  assert.deepEqual(install.files.map((file) => [file.path, file.role]), [["package.json", "manifest"], ["scripts/setup.mjs", "started"]]);
  assert.match(sent_text(install), /postinstall/);
  const ignored = await inspect(setup, "npm ci --ignore-scripts");
  assert.deepEqual(ignored.files.map((file) => file.path), ["package.json"]);
  const pip = await inspect(setup, "python -m pip install -e .");
  assert.deepEqual(pip.files.map((file) => [file.path, file.role]), [["setup.py", "started"]]);
  const requirements = await inspect(setup, "pip install -r requirements.txt requests");
  assert.deepEqual(requirements.files, []);
});

test("npm finds the nearest package.json above the location and honours --prefix", async () => {
  const setup = await fixture_env({ "package.json": JSON.stringify({ scripts: { build: "node scripts/build.mjs" } }), "scripts/build.mjs": "console.log(1)", "src/a.ts": "", "web/package.json": JSON.stringify({ scripts: { build: "node web.mjs" } }), "web/web.mjs": "" });
  const nested = await inspect(setup, "cd src; npm run build");
  assert.deepEqual(nested.gaps, []);
  assert.deepEqual(nested.files.map((file) => file.path), ["package.json", "scripts/build.mjs"]);
  const prefixed = await inspect(setup, "npm --prefix web run build");
  assert.deepEqual(prefixed.files.map((file) => file.path), ["web/package.json", "web/web.mjs"]);
  const workspace = await inspect(setup, "npm -w web run build");
  assert.deepEqual(workspace.gaps, ["Package workspace scripts were not inspected: -w web run build"]);
});

test("a script written by an earlier statement of the same command is inspected from the command text", async () => {
  const setup = await fixture_env();
  const command = "Set-Content -Path probe_tmp.py -Value @'\nimport subprocess\nsubprocess.run(cmd)\n'@\npython probe_tmp.py";
  const sources = await inspect(setup, command);
  assert.deepEqual(sources.gaps, ["Dynamic process invocation could not be inspected: cmd"]);
  assert.ok(sources.notes.some((note) => note.startsWith("script written by this command before it runs:")));
  assert.ok(sources.pins.some((pin) => pin.path.endsWith("probe_tmp.py") && pin.sha256 === null));
  const piped = await inspect(setup, "@'\nprint(1)\n'@ | Set-Content probe2.py; python probe2.py");
  assert.deepEqual(piped.gaps, []);
});

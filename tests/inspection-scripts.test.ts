import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { forget_chat_writes, record_write } from "../electron/permissions/written-files.ts";
import { fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, chat_started_at = Number.POSITIVE_INFINITY) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-scripts", chat_started_at, env: setup.env });

test("a dot-sourced script under TEMP is unavailable while absent and read once it exists", async () => {
  const setup = await fixture_env();
  const absent = await inspect(setup, '. "$env:TEMP\\check.ps1"');
  assert.deepEqual(absent.gaps, [`Source is unavailable: ${path.join(setup.temp, "check.ps1")} (ENOENT)`]);
  await fs.writeFile(path.join(setup.temp, "check.ps1"), "Write-Output outside-marker");
  const present = await inspect(setup, '. "$env:TEMP\\check.ps1"');
  assert.deepEqual(present.gaps, []);
  assert.deepEqual(present.files.map((file) => [file.path, file.role, file.outside]), [[path.join(setup.temp, "check.ps1"), "started", true]]);
  assert.match(sent_text(present), /outside-marker/);
  assert.ok(present.pins.some((pin) => pin.path === path.join(setup.temp, "check.ps1") && pin.sha256));
});

test("an outside script started by its path is read with its absolute path, its imports are loaded, secret paths stay gaps", async () => {
  const setup = await fixture_env();
  const tools = path.join(setup.temp, "tools");
  await fs.mkdir(path.join(tools, ".ssh"), { recursive: true });
  await fs.writeFile(path.join(tools, "run.py"), "import helper\nhelper.go()\n");
  await fs.writeFile(path.join(tools, "helper.py"), "def go():\n    print('helper-marker')\n");
  await fs.writeFile(path.join(tools, ".ssh", "deploy.ps1"), "Write-Output secret");
  const script = await inspect(setup, `python '${path.join(tools, "run.py")}'`);
  assert.deepEqual(script.gaps, []);
  assert.deepEqual(script.files.map((file) => [file.path, file.role]), [[path.join(tools, "run.py"), "started"], [path.join(tools, "helper.py"), "loaded"]]);
  assert.doesNotMatch(sent_text(script), /helper-marker/);
  const changed = await inspect(setup, `python '${path.join(tools, "run.py")}'`, 0);
  assert.match(sent_text(changed), /helper-marker/);
  const secret = await inspect(setup, `& '${path.join(tools, ".ssh", "deploy.ps1")}'`);
  assert.deepEqual(secret.files, []);
  assert.match(secret.gaps.join("\n"), /outside the project or protected:.*deploy\.ps1/);
  await fs.writeFile(path.join(tools, "leak.py"), "import credentials\n");
  await fs.writeFile(path.join(tools, "credentials.py"), "KEY = 'x'\n");
  const import_secret = await inspect(setup, `python '${path.join(tools, "leak.py")}'`);
  assert.deepEqual(import_secret.gaps, [`Source is outside the project or protected: ${path.join(tools, "credentials.py")}`]);
  assert.doesNotMatch(sent_text(import_secret), /KEY/);
});

test("an outside script read at runtime from a network path is never opened", async () => {
  const setup = await fixture_env();
  const sources = await inspect(setup, "Get-Content \\\\server\\share\\setup.ps1 | Invoke-Expression");
  assert.deepEqual(sources.files, []);
  assert.match(sources.gaps.join("\n"), /Source is on a network path and was not read: \\\\server\\share\\setup\.ps1/);
});

const facts = (sources: Awaited<ReturnType<typeof inspect>>) => sources.programs.map((fact) => [fact.written, fact.how, fact.path, fact.kind]);

const write_ledger = (file: string) => record_write("c-scripts", file, { actor: "main", tool: "write_file", call_id: "w1", at: Date.now(), sha256: "x", prior_birthtime: null });

test("a Python argv constant resolves to the program it starts, a second binding keeps the gap", async () => {
  const setup = await fixture_env({
    "run_sub.py": "import subprocess\ncommand = ['git', 'status']\nsubprocess.run(command)\n",
    "twice.py": "import subprocess\ncommand = ['git', 'status']\ncommand = ['git', 'push']\nsubprocess.run(command)\n",
  });
  await fs.writeFile(path.join(setup.bin, "git.exe"), native_bytes());
  const resolved = await inspect(setup, "python run_sub.py");
  assert.deepEqual(resolved.gaps, []);
  assert.deepEqual(facts(resolved), [["git", "PATH", path.join(setup.bin, "git.exe"), "native"]]);
  const twice = await inspect(setup, "python twice.py");
  assert.deepEqual(twice.gaps, ["Dynamic process invocation could not be inspected: command"]);
});

test("a Node program constant resolves, a parameter of the same name keeps the gap", async () => {
  const setup = await fixture_env({
    "run_child.js": "const child_process = require('child_process');\nconst program = 'git';\nchild_process.execFile(program, []);\n",
    "shadow.js": "const child_process = require('child_process');\nconst program = 'git';\nfunction run(program) {\n  child_process.execFile(program, []);\n}\n",
  });
  await fs.writeFile(path.join(setup.bin, "git.exe"), native_bytes());
  const resolved = await inspect(setup, "node run_child.js");
  assert.deepEqual(resolved.gaps, []);
  assert.deepEqual(facts(resolved), [["git", "PATH", path.join(setup.bin, "git.exe"), "native"]]);
  const shadow = await inspect(setup, "node shadow.js");
  assert.deepEqual(shadow.gaps, ["Dynamic process invocation could not be inspected: program, []"]);
});

test("a literal constant import_module of a project module loads it, an installed module stays silent", async () => {
  const setup = await fixture_env({
    "dyn.py": "import importlib\nmodule_name = 'helpers.tool'\nimportlib.import_module(module_name)\n",
    "helpers/tool.py": "print('tool-marker')\n",
    "std.py": "import importlib\nmodule_name = 'json'\nimportlib.import_module(module_name)\n",
    "opaque.py": "import importlib\nimportlib.import_module(name)\n",
  });
  const project = await inspect(setup, "python dyn.py", 0);
  assert.deepEqual(project.gaps, []);
  assert.deepEqual(project.files.map((file) => [file.path, file.role]), [["dyn.py", "started"], ["helpers/tool.py", "loaded"]]);
  assert.match(sent_text(project), /tool-marker/);
  const std = await inspect(setup, "python std.py");
  assert.deepEqual(std.gaps, []);
  assert.deepEqual(std.files.map((file) => file.path), ["std.py"]);
  const opaque = await inspect(setup, "python opaque.py");
  assert.match(opaque.gaps.join("\n"), /Import could not be resolved: importlib\.import_module\(name\)/);
});

test("python -m with an installed module is a fact and sends the scripts the agent wrote under the working directory", async () => {
  const setup = await fixture_env({ "tests/test_x.py": "import helper\n", "tests/helper.py": "print('helper')\n", "other/test_y.py": "print(1)\n", "tests/spec.js": "1\n" });
  write_ledger(path.join(setup.root, "tests", "test_x.py"));
  write_ledger(path.join(setup.root, "other", "test_y.py"));
  write_ledger(path.join(setup.root, "tests", "spec.js"));
  try {
    const sources = await inspect_command_sources(setup.root, path.join(setup.root, "tests"), "python -m unittest", { chat_id: "c-scripts", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env });
    assert.deepEqual(sources.gaps, []);
    assert.deepEqual(facts(sources), [["unittest", "python -m", "unittest", "installed"]]);
    assert.deepEqual(sources.files.map((file) => [file.path, file.role, file.change?.kind ?? null]), [["tests/test_x.py", "loaded", "written"], ["tests/helper.py", "loaded", null]]);
    assert.match(sent_text(sources), /import helper/);
    const project = await inspect(setup, "python -m tests.test_x");
    assert.deepEqual(project.programs, []);
    assert.deepEqual(project.files.map((file) => file.path), ["tests/test_x.py", "tests/helper.py"]);
  } finally {
    forget_chat_writes("c-scripts");
  }
});

test("python -m pip list is an installed module fact without a gap", async () => {
  const setup = await fixture_env();
  const sources = await inspect(setup, "python -m pip list");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(facts(sources), [["pip", "python -m", "pip", "installed"]]);
});

test("an environment assignment before npm test leaves no gap, a later read sees the overlay and node --test sends written tests", async () => {
  const setup = await fixture_env({ "package.json": JSON.stringify({ scripts: { test: "node --test" } }), "test/a.test.js": "require('./util.js')\n", "test/util.js": "1\n" });
  write_ledger(path.join(setup.root, "test", "a.test.js"));
  try {
    const sources = await inspect(setup, String.raw`$env:NODE_ENV = 'test'; npm test; & ".\$env:NODE_ENV.exe"`);
    assert.deepEqual(sources.gaps, []);
    assert.deepEqual(facts(sources), [[String.raw`".\$env:NODE_ENV.exe"`, "", path.join(setup.root, "test.exe"), "missing"]]);
    assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["package.json", "manifest"], ["test/a.test.js", "loaded"], ["test/util.js", "loaded"]]);
    assert.match(sent_text(sources), /require\('\.\/util\.js'\)/);
  } finally {
    forget_chat_writes("c-scripts");
  }
});

test("a dev script that spawns an imported package binary is an installed-package fact", async () => {
  const setup = await fixture_env({
    "package.json": JSON.stringify({ scripts: { dev: "node scripts/dev.mjs" } }),
    "scripts/dev.mjs": 'import { spawn } from "node:child_process";\nimport electron_path from "electron";\n\nconst launch = () => {\n  app = spawn(electron_path, ["."], {\n    stdio: "inherit",\n    env: { ...process.env, URL: url },\n  });\n};\n',
  });
  const sources = await inspect(setup, "npm run dev");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.programs.map((fact) => [fact.written, fact.how, fact.path, fact.kind, fact.line]), [["electron_path", "installed package", "electron", "installed", 5]]);
  assert.equal(sources.programs[0]?.origin, path.join(setup.root, "scripts", "dev.mjs"));
});

test("python -c follows its imports through literal sys.path changes and makes an unresolved one a gap", async () => {
  const setup = await fixture_env({
    "fresh_analysis/probe_worker.py": "import struct\n\ndef emulate(image, rva, inputs, limit):\n    return {'rva': rva}\n",
    "fresh_analysis/zydis_decode.py": "class ZydisDecoder:\n    pass\n",
    "helper.py": "print('helper-marker')\n",
  });
  const command = [
    'python -B -c "import sys,json',
    "from pathlib import Path",
    "sys.path.insert(0,str(Path('fresh_analysis').resolve()))",
    "from probe_worker import emulate",
    "from zydis_decode import ZydisDecoder",
    "print(json.dumps(emulate(b'', 0, {}, 1)))",
    '"',
  ].join("\n");
  const before = await inspect(setup, command);
  assert.deepEqual(before.gaps, []);
  assert.deepEqual(before.files.map((file) => [file.path, file.role, file.change]), [["fresh_analysis/probe_worker.py", "loaded", null], ["fresh_analysis/zydis_decode.py", "loaded", null]]);
  const changed = await inspect(setup, command, 0);
  assert.match(sent_text(changed), /def emulate/);
  const local = await inspect(setup, 'python -c "import helper"', 0);
  assert.deepEqual(local.files.map((file) => file.path), ["helper.py"]);
  const dynamic = await inspect(setup, 'python -c "import sys; sys.path.insert(0, sys.argv[1]); import helper"');
  assert.deepEqual(dynamic.gaps, ["Import path could not be resolved: sys.path.insert(0, sys.argv[1]) in python -c code."]);
  const lib = path.join(setup.temp, "lib");
  await fs.mkdir(lib);
  await fs.writeFile(path.join(lib, "outside_mod.py"), "print('outside-marker')\n");
  const outside = await inspect(setup, `python -c "import sys; sys.path.insert(0, r'${lib}'); import outside_mod"`, 0);
  assert.deepEqual(outside.gaps, []);
  assert.deepEqual(outside.files.map((file) => [file.path, file.outside]), [[path.join(lib, "outside_mod.py"), true]]);
  assert.match(sent_text(outside), /outside-marker/);
});

test("a shell script that ends a line with a -c style flag is inspected instead of failing", async () => {
  const setup = await fixture_env({ "setup.sh": "sh ./sub.sh --clean -c\nbash -lc\nfind . -exec\n", "sub.sh": "echo sub-marker\n" });
  const sources = await inspect(setup, "bash -c './setup.sh'");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["setup.sh", "started"], ["sub.sh", "started"]]);
});

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { code_mask } from "../electron/permissions/script-text.ts";
import { process_refs } from "../electron/permissions/script-refs.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { forget_chat_writes, record_write } from "../electron/permissions/written-files.ts";
import { fixture_env, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, chat_id = "c-scan", chat_started_at = Number.POSITIVE_INFINITY) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id, chat_started_at, env: setup.env });

const written = (chat_id: string, setup: FixtureEnv, files: string[]) => {
  for (const file of files) record_write(chat_id, path.join(setup.root, file), { actor: "main", tool: "write_file", call_id: "w", at: Date.now(), sha256: "x", prior_birthtime: null });
};

test("only the program and the script or code element of a process call must be literal", () => {
  const python = process_refs("import subprocess, sys\nsubprocess.run(['git', 'checkout', branch])\nsubprocess.run([sys.executable, '-m', 'pip', 'list'])\nsubprocess.run(['python', script])\nos.system('git ' + x)\n", "python");
  assert.deepEqual(python.commands, ["git checkout !argument!", "python -m pip list"]);
  assert.deepEqual(python.gaps, ["Dynamic process invocation could not be inspected: ['python', script]", "Dynamic process invocation could not be inspected: 'git ' + x"]);
  const js = process_refs("const { exec, execFileSync, spawn } = require('child_process');\nexecFileSync('git', ['add', file]);\nspawn('node', args);\nexec(`git ${x}`);\n", "js");
  assert.deepEqual(js.commands, ["git add !argument!"]);
  assert.equal(js.gaps.length, 2);
  const shell = process_refs("import subprocess\nsubprocess.run(['git', branch], shell=True)\n", "python");
  assert.equal(shell.gaps.length, 1);
});

test("raw string constants are constants", () => {
  const found = process_refs("import subprocess\nTOOL = r'C:\\x\\dumpbin.exe'\nsubprocess.run([TOOL, '/headers', name])\n", "python");
  assert.deepEqual(found.gaps, []);
  assert.deepEqual(found.commands, ["C:\\x\\dumpbin.exe /headers !argument!"]);
});

test("regular expression literals and strings are masked in JavaScript", () => {
  assert.doesNotMatch(code_mask("const r = /(?:spawn(?:Sync)?)\\s*\\($/.test(x);\n", "js"), /spawn/);
  assert.match(code_mask("const half = a / b; spawn(x) / 2;\n", "js"), /spawn/);
  const scanned = process_refs("const child_process = 1;\nconst pattern = /(?:execFile(?:Sync)?|spawn(?:Sync)?)\\s*\\($/;\n", "js");
  assert.deepEqual(scanned.gaps, []);
});

test("from-imports load submodules and dotted imports load their package init files", async () => {
  const setup = await fixture_env({ "main.py": "from gen import opcodes\nimport pkg.sub.mod\n", "gen/__init__.py": "", "gen/opcodes.py": "X = 1\n", "pkg/__init__.py": "", "pkg/sub/__init__.py": "", "pkg/sub/mod.py": "" });
  const sources = await inspect(setup, "python main.py", "c-scan", 0);
  assert.deepEqual(sources.files.map((file) => file.path).sort(), ["gen/__init__.py", "gen/opcodes.py", "main.py", "pkg/__init__.py", "pkg/sub/__init__.py", "pkg/sub/mod.py"]);
});

test("node -e code has its relative requires followed", async () => {
  const setup = await fixture_env({ "scripts/lib/util.cjs": "module.exports = { main() {} }\n" });
  const sources = await inspect(setup, "node -e \"require('./scripts/lib/util.cjs').main()\"", "c-scan", 0);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["scripts/lib/util.cjs", "loaded"]]);
});

test("runner discovery reads only test files for pytest and node --test, and none for other modules", async () => {
  const setup = await fixture_env({ "tools/run_tests.py": "import subprocess\nsubprocess.run(cmd)\n", "tests/test_core.py": "import tools.helper\n", "tools/helper.py": "", "tests/old_test.py": "", "conftest.py": "" });
  const chat = "c-scan-runner";
  written(chat, setup, ["tools/run_tests.py", "tests/test_core.py"]);
  const pip = await inspect(setup, "python -m pip list", chat);
  assert.deepEqual(pip.files, []);
  assert.deepEqual(pip.gaps, []);
  const pytest = await inspect(setup, "python -m pytest tests", chat);
  assert.deepEqual(pytest.gaps, []);
  assert.deepEqual(pytest.files.map((file) => file.path).sort(), ["conftest.py", "tests/old_test.py", "tests/test_core.py", "tools/helper.py"]);
  forget_chat_writes(chat);
});

test("an installed JavaScript tool run sends agent-written sources without raising their scan findings", async () => {
  const setup = await fixture_env({ "package.json": JSON.stringify({ scripts: { dev: "electron ." } }), "node_modules/.bin/electron.cmd": "@echo electron", "src/main.mjs": "import { exec } from 'node:child_process';\nconst child_process = 1;\nexec(command);\n" });
  const chat = "c-scan-installed";
  written(chat, setup, ["src/main.mjs"]);
  const sources = await inspect(setup, "npm run dev", chat);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role, file.change?.kind ?? null]), [["package.json", "manifest", null], ["src/main.mjs", "loaded", "written"]]);
  assert.ok(sources.notes.some((note) => note.startsWith("not raised, inside an agent-written file an installed tool may load: Dynamic process invocation")));
  forget_chat_writes(chat);
});

test("loaded modules changed on disk but not written by the agent report their findings as notes", async () => {
  const setup = await fixture_env({ "main.py": "import vendor_lib\n", "vendor_lib.py": "import subprocess, sys\nsys.path.insert(0, os.environ['X'])\nsubprocess.call(cmd, shell=True)\n" });
  const changed = await inspect(setup, "python main.py", "c-scan", 0);
  assert.deepEqual(changed.gaps, []);
  assert.equal(changed.notes.filter((note) => note.startsWith("not raised")).length, 2);
  const chat = "c-scan-vendor";
  written(chat, setup, ["vendor_lib.py"]);
  const agent = await inspect(setup, "python main.py", chat, 0);
  assert.equal(agent.gaps.length, 2);
  forget_chat_writes(chat);
});

test("over the listing limit only files that can force a card raise a gap", async () => {
  const modules: Record<string, string> = { "main.py": Array.from({ length: 205 }, (_, index) => `import m${index}`).join("\n") };
  for (let index = 0; index < 205; index += 1) modules[`m${index}.py`] = "";
  const setup = await fixture_env(modules);
  const sources = await inspect(setup, "python main.py");
  assert.deepEqual(sources.gaps, []);
  assert.ok(sources.notes.includes("loaded files over the limit of 200, not read: 5"));
});

test("a loaded module over the read limit forces only when the agent wrote it", async () => {
  const setup = await fixture_env({ "main.py": "import big\n", "big.py": "x = 1\n" + "#".repeat(1100000) });
  const changed = await inspect(setup, "python main.py", "c-scan", 0);
  assert.deepEqual(changed.gaps, []);
  const chat = "c-scan-big";
  written(chat, setup, ["big.py"]);
  const agent = await inspect(setup, "python main.py", chat, 0);
  assert.match(agent.gaps.join("\n"), /exceeds the read limit/);
  forget_chat_writes(chat);
  assert.deepEqual(changed.files.map((file) => [file.path, file.over_limit]), [["main.py", false], ["big.py", true]]);
});

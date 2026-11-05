import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { send_candidate } from "../electron/permissions/source-files.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-script-paths", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env });

const on_path = async (setup: FixtureEnv, ...names: string[]) => {
  for (const name of names) await fs.writeFile(path.join(setup.bin, name), native_bytes());
};

test("a script that starts the file next to it through a local binding has that file followed and sent", async () => {
  const setup = await fixture_env({
    "tools/run.py": "import shutil, subprocess\nfrom pathlib import Path\n\ndef main():\n    helper = Path(__file__).with_name('helper.mjs')\n    node = shutil.which('node')\n    if not node or not helper.exists():\n        return\n    subprocess.run([node, str(helper), 'out'])\n\nmain()\n",
    "tools/helper.mjs": "console.log('helper-marker');\n",
  });
  await on_path(setup, "node.exe", "python.exe");
  const sources = await inspect(setup, "python tools/run.py");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.filter(send_candidate).map((file) => [file.path, file.role]), [["tools/run.py", "started"], ["tools/helper.mjs", "started"]]);
  assert.match(sent_text(sources), /helper-marker/);
  assert.deepEqual(fact_rows(sources), [["python", "PATH", path.join(setup.bin, "python.exe"), "native"], ["node", "PATH", path.join(setup.bin, "node.exe"), "native"]]);
});

test("node --check, node -c, py_compile and compileall parse files without starting them", async () => {
  const setup = await fixture_env({
    "src/app.js": "console.log('app-marker');\n",
    "src/mod.py": "print('mod-marker')\n",
    "tools/lint.py": "import shutil, subprocess, sys\nfrom pathlib import Path\n\ndef lint(files):\n    node = shutil.which('node')\n    for p in files:\n        subprocess.run([node, '--check', str(p)])\n        subprocess.run([sys.executable, '-m', 'py_compile', str(p)])\n    subprocess.run([sys.executable, '-m', 'compileall', str(Path(__file__).parent)])\n",
  });
  await on_path(setup, "node.exe", "python.exe");
  for (const command of ["node --check src/app.js", "node -c src/app.js", "python -m py_compile src/mod.py", "python -m compileall src"]) {
    const sources = await inspect(setup, command);
    assert.deepEqual(sources.gaps, [], command);
    assert.deepEqual(sources.files.filter(send_candidate), [], command);
    assert.ok(sources.programs.length > 0, command);
  }
  const lint = await inspect(setup, "python tools/lint.py");
  assert.deepEqual(lint.gaps, []);
  assert.deepEqual(lint.files.filter(send_candidate).map((file) => file.path), ["tools/lint.py"]);
  assert.deepEqual(fact_rows(lint).map((row) => row[0]), ["python", "node", "py_compile", "compileall"]);
});

test("the bundled effects-lab lint sends check.py, and its node --check call on the page scripts leaves no gap", async () => {
  const setup = await fixture_env();
  const tools = path.join(setup.temp, "app resources", "effects-lab", "tools");
  await fs.cp(path.join(import.meta.dirname, "..", "skills", "design", "effects-lab", "tools"), tools, { recursive: true });
  await on_path(setup, "node.exe", "python.exe");
  const check = await inspect(setup, `python "${path.join(tools, "check.py")}" out/wireframe_3d`);
  assert.deepEqual(check.files.filter(send_candidate).map((file) => [file.path, file.role]), [[path.join(tools, "check.py"), "started"]]);
  assert.deepEqual(check.gaps, []);
  assert.deepEqual(fact_rows(check).map((row) => row.slice(0, 2)), [["python", "PATH"], ["node", "PATH"]]);
  const scaffold = await inspect(setup, `python "${path.join(tools, "scaffold.py")}" wireframe_3d out/wireframe_3d`);
  assert.deepEqual(scaffold.gaps, []);
});

test("a call-site value of the started script is a gap once a loaded module reaches into __main__", async () => {
  const run = "import subprocess\nimport helper\n\ndef tool(name):\n    subprocess.run([name, '--version'])\n\ntool('node')\n";
  const quiet = await fixture_env({ "tools/run.py": run, "tools/helper.py": "VALUE = 1\n" });
  await on_path(quiet, "node.exe", "python.exe");
  assert.deepEqual((await inspect_command_sources(quiet.root, quiet.root, "python tools/run.py", { chat_id: "c-script-reach", chat_started_at: 0, env: quiet.env })).gaps, []);
  const reaching = await fixture_env({ "tools/run.py": run, "tools/helper.py": "import __main__\n__main__.tool(input())\n" });
  await on_path(reaching, "node.exe", "python.exe");
  const sources = await inspect_command_sources(reaching.root, reaching.root, "python tools/run.py", { chat_id: "c-script-reach", chat_started_at: 0, env: reaching.env });
  assert.equal(sources.gaps.length, 1);
  assert.match(sources.gaps[0] ?? "", /^A loaded module reaches into the started script/);
});

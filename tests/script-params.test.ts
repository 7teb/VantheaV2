import assert from "node:assert/strict";
import { test } from "node:test";
import { process_refs } from "../electron/permissions/script-refs.ts";

const python = (text: string, entry = true) => process_refs(text, "python", String.raw`D:\work\project\tools\run.py`, entry);
const node = (text: string, entry = true) => process_refs(text, "js", String.raw`D:\work\project\tools\run.js`, entry);

const major = 'import shutil, subprocess\ndef node_major(node):\n    return subprocess.run([node, "--version"], capture_output=True)\ndef check():\n    node = shutil.which("node")\n    if node_major(node) < 22:\n        print(f"found {node_major(node)}")\n';

test("a parameter of the started script resolves to the values every call site passes", () => {
  const found = python(major);
  assert.deepEqual(found.gaps, []);
  assert.deepEqual(found.commands, ["node --version"]);
  assert.equal(found.callers, true);
  assert.equal(python(major, false).gaps.length, 1);
  const two = python("import subprocess\ndef tool(name, flag):\n    subprocess.run([name, flag])\ntool('git', '--version')\ntool('npm', '--version')\n");
  assert.deepEqual(two.commands, ["git --version", "npm --version"]);
  assert.deepEqual(python("import subprocess\ndef run(name):\n    subprocess.run([name, 'status'])\nclass Job:\n    def go(self):\n        self.run()\nrun('git')\n").commands, ["git status"]);
  const chained = python("import subprocess\ndef inner(name):\n    subprocess.run([name])\ndef outer(name):\n    inner(name)\nouter('git')\n");
  assert.deepEqual(chained.commands, ["git"]);
  const js = node("const { spawnSync } = require('child_process');\nfunction run(program) {\n  return spawnSync(program, ['-v']);\n}\nconst probe = (program) => spawnSync(program, []);\nrun('git');\nprobe(`node`);\n");
  assert.deepEqual(js.gaps, []);
  assert.deepEqual(js.commands, ["git -v", "node"]);
});

test("a parameter stays unresolved when any caller is unseen, dynamic or writes it", () => {
  const head = "import subprocess, sys, threading\ndef run(name, flag='-v'):\n    subprocess.run([name])\n";
  for (const rest of [
    "run(sys.argv[1])\n",
    "run('git')\nprint(f\"{run(sys.argv[1])}\")\n",
    "run('git')\nthreading.Thread(target=run).start()\n",
    "run('git')\nhooks = [run]\n",
    "run('git')\nrun(*sys.argv[1:])\n",
    "run(name='git')\n",
    "run('git')\nimport __main__\n",
    "run('git')\nimportlib.import_module(__name__).run(sys.argv[1])\n",
    "",
  ]) {
    assert.equal(python(head + rest).gaps.length, 1, rest);
  }
  assert.equal(python("import subprocess, sys\ndef run(name):\n    name = name.strip()\n    subprocess.run([name])\nrun('git')\n").gaps.length, 1);
  assert.equal(python("import subprocess\ndef run(cmd):\n    subprocess.run(cmd)\nrun(['git', 'status'])\n").gaps.length, 1);
  assert.equal(python("import subprocess\n@cache\ndef run(name):\n    subprocess.run([name])\nrun('git')\n").gaps.length, 1);
  assert.equal(python("import subprocess\nclass Tools:\n    def run(self, name):\n        subprocess.run([name])\nTools().run('git')\n").gaps.length, 1);
  const js_head = "const { spawnSync } = require('child_process');\n";
  for (const rest of [
    "export function run(program) { spawnSync(program, []); }\nrun('git');\n",
    "function run(program) { spawnSync(program, []); }\nrun('git');\nmodule.exports = { run };\n",
    "function run(program) { spawnSync(program, []); }\nrun('git');\nsetTimeout(run, 1);\n",
    "function run(program) { spawnSync(program, []); }\nrun(...process.argv.slice(2));\n",
    "let run = (program) => spawnSync(program, []);\nrun('git');\nrun = other;\n",
    "function run(program) { arguments[0] = process.argv[2]; spawnSync(program, []); }\nrun('git');\n",
    "function run(program) { spawnSync(program, []); }\nrun.call(null, process.argv[2]);\n",
  ]) {
    assert.equal(node(js_head + rest).gaps.length, 1, rest);
  }
});

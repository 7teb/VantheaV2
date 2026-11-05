import assert from "node:assert/strict";
import { test } from "node:test";
import { script_constants } from "../electron/permissions/script-constants.ts";
import { process_refs } from "../electron/permissions/script-refs.ts";

const script = String.raw`D:\work\project\tools\run.py`;
const python = (text: string) => process_refs(text, "python", script);
const node = (text: string) => process_refs(text, "js", String.raw`D:\work\project\tools\run.js`);

test("a name assigned once inside a function resolves in that function", () => {
  const lint = python('import shutil, subprocess\ndef lint(files):\n    node = shutil.which("node")\n    if node:\n        for p in files:\n            r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)\n            report(f"{p}: {r.returncode} {node}")\n');
  assert.deepEqual(lint.gaps, []);
  assert.deepEqual(lint.commands, ["node --check !argument!"]);
  const chained = python('import subprocess, sys\nfrom pathlib import Path\ndef run():\n    here = Path(__file__).parent  # tools folder\n    tool = here / "helper.py"\n    configure(tool=None)\n    subprocess.run([sys.executable, str(tool)])\n');
  assert.deepEqual(chained.commands, [String.raw`python D:\work\project\tools\helper.py`]);
  const multi_line = python('import os, subprocess\ndef run():\n    tool = os.path.join(\n        os.path.dirname(__file__),\n        "helper.py",\n    )\n    subprocess.run(["python", tool])\n');
  assert.deepEqual(multi_line.commands, [String.raw`python D:\work\project\tools\helper.py`]);
  const js = node("const child_process = require('child_process');\nfunction run() {\n  const program = 'git';\n  console.log(program);\n  if (ready) { var tool = 'npm'; }\n  child_process.execFile(program, []);\n  child_process.execFile(tool, []);\n}\nconst later = () => {\n  const program = 'node';\n  child_process.execFile(program, []);\n};\n");
  assert.deepEqual(js.gaps, []);
  assert.deepEqual(js.commands, ["git", "npm", "node"]);
  assert.deepEqual(script_constants("def run():\n    node = 'node'\n", "python").frames.flatMap((frame) => [...frame.values]), [["node", "'node'"]]);
});

test("a second write of any kind leaves a function binding unresolved", () => {
  const writes = [
    "    node = 'rm'\n",
    "    other, node = 1, 'rm'\n",
    "    for node in names:\n        pass\n",
    "    with open(name) as node:\n        pass\n",
    "    if (node := pick()):\n        pass\n",
    "    def inner():\n        node = 'rm'\n",
    "    def inner():\n        nonlocal node\n",
    "    from tools import (\n        other,\n        node,\n    )\n",
    "    print(f\"{(node := 'rm')}\")\n",
    "    node += '.exe'\n",
    "    del node\n",
  ];
  for (const write of writes) {
    const text = `import subprocess\ndef run():\n    node = 'git'\n${write}    subprocess.run([node])\n`;
    assert.deepEqual(python(text).gaps, ["Dynamic process invocation could not be inspected: [node]"], write);
  }
  for (const head of ["def run(node):\n", "def run(other, node=None):\n"]) {
    assert.equal(python(`import subprocess\n${head}    node = 'git'\n    subprocess.run([node])\n`).gaps.length, 1, head);
  }
  assert.equal(python("import subprocess\ndef run():\n    node = 'git' \\\n        + suffix\n    subprocess.run([node])\n").gaps.length, 1);
  assert.deepEqual(python("import subprocess\ndef run():\n    node = 'git'\n    subprocess.run([node])\n").commands, ["git"]);
  const js_writes: [string, number][] = [
    ["", 0],
    ["  program = 'rm';\n", 1],
    ["  [other, program] = pair;\n", 1],
    ["  ({ program } = config);\n", 1],
    ["  program += '.exe';\n", 1],
    ["  program++;\n", 1],
    ["  names.forEach((program) => child_process.execFile(program, []));\n", 2],
    ["  try { go(); } catch (program) { child_process.execFile(program, []); }\n", 2],
    ["  console.log(`${program = 'rm'}`);\n", 1],
  ];
  for (const [write, gaps] of js_writes) {
    const text = `const child_process = require('child_process');\nfunction run() {\n  let program = 'git';\n${write}  child_process.execFile(program, []);\n}\n`;
    assert.equal(node(text).gaps.length, gaps, write);
  }
  assert.equal(node("const child_process = require('child_process');\nfunction run() {\n  const program = 'git'\n    .replace('g', 'r');\n  child_process.execFile(program, []);\n}\n").gaps.length, 1);
});

test("a function binding does not leak out of its function, class body or block", () => {
  const outside = ["import subprocess\ndef run():\n    node = 'git'\nsubprocess.run([node])\n", "import subprocess\ndef run():\n    class Tools:\n        node = 'git'\n    subprocess.run([node])\n"];
  for (const text of outside) assert.equal(python(text).gaps.length, 1, text);
  assert.equal(node("const child_process = require('child_process');\nfunction run() {\n  if (ready) { const program = 'git'; }\n  child_process.execFile(program, []);\n}\n").gaps.length, 1);
  assert.equal(node("const child_process = require('child_process');\nif (ready) {\n  const program = 'git';\n  child_process.execFile(program, []);\n}\n").gaps.length, 1);
});

test("a list bound in a function resolves only while every other use is a process call", () => {
  assert.deepEqual(python("import subprocess\ndef run():\n    command = ['git', 'status']\n    subprocess.run(command)\n").commands, ["git status"]);
  for (const use of ["    command.append('push')\n", "    command[0] = 'rm'\n", "    print(f\"{command.pop()}\")\n", "    extend(command)\n"]) {
    assert.equal(python(`import subprocess\ndef run():\n    command = ['git', 'status']\n${use}    subprocess.run(command)\n`).gaps.length, 1, use);
  }
});

test("a parameter, a call result or a conditional with an unresolved branch stays unresolved", () => {
  assert.deepEqual(python('import subprocess\ndef node_major(node):\n    return subprocess.run([node, "--version"], capture_output=True)\n').gaps, ['Dynamic process invocation could not be inspected: [node, "--version"], capture_output=True']);
  assert.deepEqual(node("const { spawnSync } = require('child_process');\nfunction find() {\n  const finder = process.platform === 'win32' ? 'where' : process.env.FINDER;\n  return spawnSync(finder, [name]);\n}\n").gaps, ["Dynamic process invocation could not be inspected: finder, [name]"]);
  assert.equal(python("import subprocess\ndef run():\n    node = locate('node')\n    subprocess.run([node])\n").gaps.length, 1);
  assert.equal(python("import subprocess, sys\ndef run():\n    tool = 'git' if fast else sys.argv[1]\n    subprocess.run([tool])\n").gaps.length, 1);
});

test("a conditional whose branches all resolve is inspected once per branch", () => {
  const js = node("const { spawnSync } = require('child_process');\nfunction find() {\n  const finder = process.platform === 'win32' ? 'where' : 'which';\n  return spawnSync(finder, [name]);\n}\nspawnSync(ok ? (a ? 'git' : 'npm') : 'node', ['-v']);\n");
  assert.deepEqual(js.gaps, []);
  assert.deepEqual(js.commands, ["where !argument!", "which !argument!", "git -v", "npm -v", "node -v"]);
  const py = python("import subprocess\ndef run(fast):\n    tool = 'git' if fast else 'hg'\n    subprocess.run([tool, 'status'])\n    subprocess.run(['python' if fast else 'py', '-V'])\n");
  assert.deepEqual(py.gaps, []);
  assert.deepEqual(py.commands, ["git status", "hg status", "python -V", "py -V"]);
  assert.equal(node("const { spawnSync } = require('child_process');\nspawnSync(a ?? 'git', []);\nspawnSync(cfg?.tool, []);\n").gaps.length, 2);
});

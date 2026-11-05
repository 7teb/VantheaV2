import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { import_folders } from "../electron/permissions/python-paths.ts";
import { process_refs } from "../electron/permissions/script-refs.ts";
import { code_mask } from "../electron/permissions/script-text.ts";

const folder = String.raw`D:\work\project\tools`;
const next_to = (name: string) => path.win32.join(folder, name);
const python = (text: string, file = next_to("run.py")) => process_refs(text, "python", file);
const node = (text: string, file = next_to("run.js")) => process_refs(text, "js", file);

test("shutil.which and a which imported from shutil resolve to the program looked up on PATH", () => {
  assert.deepEqual(python('import subprocess, shutil\nsubprocess.run([shutil.which("git"), "status"])\n').commands, ["git status"]);
  const imported = python('import subprocess\nfrom shutil import which\nsubprocess.run([which("node"), "--version"])\n');
  assert.deepEqual(imported.commands, ["node --version"]);
  assert.deepEqual(imported.gaps, []);
  for (const text of [
    'import subprocess\nsubprocess.run([which("git")])\n',
    'import subprocess\nfrom shutil import which\ndef which(name):\n    return "other"\nsubprocess.run([which("git")])\n',
  ]) {
    assert.deepEqual(python(text).gaps, ['Dynamic process invocation could not be inspected: [which("git")]'], text);
  }
});

test("Python paths built from the running script resolve to the file next to it", () => {
  const forms = [
    'str(Path(__file__).with_name("helper.py"))',
    'Path(__file__).parent / "helper.py"',
    'Path(__file__).resolve().parent / "helper.py"',
    '(Path(__file__).parent / "helper.py").resolve()',
    '(Path(__file__).absolute().parent / "helper.py").absolute()',
    'os.path.join(os.path.dirname(__file__), "helper.py")',
    'os.path.join(os.path.dirname(os.path.abspath(__file__)), "helper.py")',
  ];
  for (const form of forms) {
    const found = python(`import os, subprocess, sys\nfrom pathlib import Path\nsubprocess.run([sys.executable, ${form}])\n`);
    assert.deepEqual(found.gaps, [], form);
    assert.deepEqual(found.commands, [`python ${next_to("helper.py")}`], form);
  }
  const bound = python('import os, subprocess, sys\nHERE = os.path.dirname(os.path.abspath(__file__))\nsubprocess.run([sys.executable, os.path.join(HERE, "helper.py")])\n');
  assert.deepEqual(bound.commands, [`python ${next_to("helper.py")}`]);
  const spaced = process_refs('import subprocess, sys\nfrom pathlib import Path\nsubprocess.run([sys.executable, Path(__file__).with_name("helper.py")])\n', "python", String.raw`C:\Program Files\App\tools\run.py`);
  assert.deepEqual(spaced.commands, [String.raw`python "C:\Program Files\App\tools\helper.py"`]);
});

test("JavaScript paths built from __dirname and import.meta.url resolve to the file next to the script", () => {
  const common = node("const { spawn } = require('child_process');\nconst path = require('path');\nspawn(process.execPath, [path.join(__dirname, 'helper.js')]);\n");
  assert.deepEqual(common.commands, [`node ${next_to("helper.js")}`]);
  const module = node("import { spawn } from 'node:child_process';\nimport { fileURLToPath } from 'node:url';\nspawn('node', [fileURLToPath(new URL('./helper.mjs', import.meta.url))]);\nspawn('node', [new URL('helper.mjs', import.meta.url)]);\n", next_to("run.mjs"));
  assert.deepEqual(module.gaps, []);
  assert.deepEqual(module.commands, [`node ${next_to("helper.mjs")}`, `node ${next_to("helper.mjs")}`]);
});

test("a script that writes __file__, __dirname or sys.executable itself does not get the built-in value", () => {
  const cases: [string, "python" | "js"][] = [
    ["import subprocess, sys\nfrom pathlib import Path\ndef move():\n    global __file__\n    __file__ = other\nsubprocess.run([sys.executable, Path(__file__).with_name('helper.py')])\n", "python"],
    ["import subprocess, sys\nsys.executable = 'other.exe'\nsubprocess.run([sys.executable, '-V'])\n", "python"],
    ["const { spawn } = require('child_process');\nconst path = require('path');\nconst __dirname = process.env.TOOLS;\nconsole.log(__dirname);\nspawn(process.execPath, [path.join(__dirname, 'helper.js')]);\n", "js"],
  ];
  for (const [text, language] of cases) {
    assert.equal(process_refs(text, language, next_to(language === "js" ? "run.js" : "run.py")).gaps.length, 1, text);
  }
  assert.equal(python("import subprocess, sys\nfrom pathlib import Path\nsubprocess.run([sys.executable, Path(__file__).with_name('helper.py')])\n", "").gaps.length, 1);
});

test("a library name resolves only while it is bound by its own import and nothing patches it", () => {
  const launch = 'subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "helper.py")])\n';
  assert.deepEqual(python(`import os, subprocess, sys\n${launch}`).gaps, []);
  assert.deepEqual(python(`import os.path, subprocess, sys\n${launch}`).gaps, []);
  for (const head of [
    "import subprocess, sys\nimport fake as os\n",
    "import os, subprocess, sys\nos.path.join = lambda *a: sys.argv[1]\n",
    "import os, subprocess, sys\nalias = os.path\nalias.join = pick\n",
    "import os, subprocess, sys\nos = load()\n",
    "import os, subprocess, sys\nfrom fake import \\\n    os\n",
    "import os, subprocess, sys\ndef f(os):\n    pass\n",
    "import os, subprocess, sys\nos.path.__dict__['join'] = pick\n",
    "import os, subprocess, sys\nsys.modules['os'] = fake\n",
    "import os, subprocess, sys\nimport builtins\nbuiltins.str.__class__ = pick\n",
    "import subprocess, sys\n",
  ]) {
    assert.equal(python(head + launch).gaps.length, 1, head);
  }
  const path_launch = 'subprocess.run([sys.executable, str(Path(__file__).with_name("helper.py"))])\n';
  assert.deepEqual(python(`import subprocess, sys\nfrom pathlib import Path\n${path_launch}`).gaps, []);
  for (const head of [
    "import subprocess, sys\nfrom pathlib import Path\ndef Path(x):\n    return sys.argv[1]\n",
    "import subprocess, sys\nfrom fake import Path\n",
    "import subprocess, sys\nfrom pathlib import Path\nPath.with_name = pick\n",
    "import subprocess, sys\nfrom pathlib import Path\nstr = repr\n",
  ]) {
    assert.equal(python(head + path_launch).gaps.length, 1, head);
  }
  for (const head of ["import subprocess\nimport fake as shutil\n", "import subprocess, shutil\nshutil.which = pick\n"]) {
    assert.equal(python(`${head}subprocess.run([shutil.which("node"), "-v"])\n`).gaps.length, 1, head);
  }
  assert.equal(import_folders("import os, sys\nos.chdir(sys.argv[1])\nsys.path.insert(0, os.getcwd())\n", next_to("run.py"), folder).gaps.length, 1);
});

test("a JavaScript module name resolves only while it is the built-in module, not escaped, patched or shadowed", () => {
  const launch = "spawn(process.execPath, [path.join(__dirname, 'helper.js')]);\n";
  const head = "const { spawn } = require('child_process');\n";
  assert.deepEqual(node(`${head}const path = require('node:path');\n${launch}`).gaps, []);
  const esm = node("import { spawn } from 'node:child_process';\nimport * as path from 'path';\nimport { fileURLToPath } from 'url';\nconst here = path.dirname(fileURLToPath(import.meta.url));\nspawn(process.execPath, [path.join(here, 'helper.js')]);\n", next_to("run.mjs"));
  assert.deepEqual(esm.commands, [`node ${next_to("helper.js")}`]);
  for (const setup of [
    "const path = require('./evilpath');\n",
    "const path = require('path');\npath.join = pick;\n",
    "const path = require('path');\npath.win32['join'] = pick;\n",
    "const path = require('path');\nObject.assign(path, { join: pick });\n",
    "const path = require('path');\nconst alias = path.win32;\nalias.join = pick;\n",
    "const require = pick;\nconst path = require('path');\n",
    "let path = require('path');\npath = other;\n",
    "const path = require('path');\nObject.defineProperty(process, 'execPath', { value: 'x' });\n",
    "const path = require('path');\nglobalThis.process = other;\n",
  ]) {
    assert.equal(node(`${head}${setup}${launch}`).gaps.length, 1, setup);
  }
  const module = (setup: string) => node(`import { spawn } from 'node:child_process';\nimport { fileURLToPath } from 'node:url';\n${setup}spawn('python', [fileURLToPath(new URL('helper.py', import.meta.url))]);\n`, next_to("run.mjs"));
  assert.deepEqual(module("").gaps, []);
  for (const setup of ["import.meta.url = 'file:///C:/other/';\n", "Object.assign(import.meta, { url: 'file:///C:/other/' });\n", "class URL {}\n", "URL.prototype.x = 1;\n", "const fileURLToPath = pick;\n"]) {
    assert.equal(module(setup).gaps.length, 1, setup);
  }
});

test("a JavaScript with block leaves every binding in the file unresolved", () => {
  const head = "const { spawnSync } = require('child_process');\n";
  assert.equal(node(`${head}const t = 'git';\nwith (obj) { spawnSync(t, []); }\n`).gaps.length, 1);
  assert.equal(node(`${head}function f() {\n  const t = 'git';\n  with (obj) { spawnSync(t, []); }\n}\n`).gaps.length, 1);
  assert.deepEqual(node(`${head}const t = 'git';\nspawnSync(t, [items.with(0, 1)]);\n`).gaps, []);
});

test("an unresolved preload after node --check is a gap on the call, an unresolved last file is not", () => {
  assert.deepEqual(python('import subprocess, sys\nsubprocess.run(["node", "--check", "--require", sys.argv[1], "main.js"])\n').gaps, ['Dynamic process invocation could not be inspected: ["node", "--check", "--require", sys.argv[1], "main.js"]']);
  assert.equal(python('import subprocess, sys\nsubprocess.run(["node", "-c", "--import", sys.argv[1], "main.js"])\n').gaps.length, 1);
  assert.equal(python('import subprocess, sys\nsubprocess.run(["node", "--check", sys.argv[1], "main.js"])\n').gaps.length, 1);
  assert.deepEqual(python('import subprocess, sys\nsubprocess.run(["node", "--check", "--require", "./pre.cjs", sys.argv[1]])\n').commands, ["node --check --require ./pre.cjs !argument!"]);
});

test("the comment-only mask keeps strings and blanks comments in both languages", () => {
  assert.equal(code_mask("x = 'a#b'  # note\n", "python", false), "x = 'a#b'        \n");
  assert.equal(code_mask("const a = '//x'; // note\nconst r = /y/;\n", "js", false), "const a = '//x';        \nconst r = /y/;\n");
});

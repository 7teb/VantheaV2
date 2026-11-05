import assert from "node:assert/strict";
import { test } from "node:test";
import { script_constants, substitute } from "../electron/permissions/script-constants.ts";
import { process_refs } from "../electron/permissions/script-refs.ts";

test("a single top-level binding used only as a process argument resolves", () => {
  const python = script_constants("import subprocess\ncommand = ['git', 'status']\nsubprocess.run(command)\n", "python");
  assert.deepEqual([...python.values], [["command", "['git', 'status']"]]);
  const js = script_constants("const child_process = require('child_process');\nconst program = 'git';\nchild_process.execFile(program, []);\n", "js");
  assert.deepEqual([...js.values], [["program", "'git'"]]);
  assert.deepEqual(process_refs("import subprocess\ncommand = ['git', 'status']\nsubprocess.run(command)\n", "python").commands, ["git status"]);
});

test("a multi-line list binding resolves and the substitution keeps the other arguments", () => {
  const text = "import subprocess\nTOOLS = [\n    'git',\n    'fetch',\n]\nsubprocess.check_call(TOOLS)\n";
  assert.deepEqual(process_refs(text, "python").commands, ["git fetch"]);
  assert.equal(substitute("TOOLS, cwd", new Map([["TOOLS", "['a']"]])), "['a'], cwd");
  assert.equal(substitute("'TOOLS', TOOLS", new Map([["TOOLS", "['a']"]])), "'TOOLS', ['a']");
});

test("two bindings, a parameter of the same name or a mutation leave the name unresolved", () => {
  const cases = [
    "import subprocess\ncommand = ['git']\ncommand = ['rm']\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\ndef go(command):\n    subprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\ncommand.append('push')\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\nif x:\n    command = ['rm']\nsubprocess.run(command)\n",
  ];
  for (const text of cases) {
    assert.equal(script_constants(text, "python").values.size, 0, text);
    assert.match(process_refs(text, "python").gaps.join("\n"), /Dynamic process invocation could not be inspected: command/, text);
  }
  const shadow = "const child_process = require('child_process');\nconst program = 'git';\nfunction run(program) { child_process.execFile(program, []); }\n";
  assert.equal(script_constants(shadow, "js").values.size, 0);
});

test("a star import or dynamic scope access disables every constant", () => {
  for (const text of [
    "from tools import *\nimport subprocess\ncommand = ['git']\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\nglobals()['command'] = ['rm']\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\nsetattr(mod, 'command', 1)\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git']\nexec(code)\nsubprocess.run(command)\n",
  ]) {
    assert.equal(script_constants(text, "python").values.size, 0, text);
  }
});

test("only plain string literals and lists of them are constants", () => {
  for (const text of [
    "import subprocess\ncommand = f'git {x}'\nsubprocess.run(command)\n",
    "import subprocess\ncommand = ['git', branch]\nsubprocess.run(command)\n",
    "import subprocess\ncommand = 'git' + suffix\nsubprocess.run(command)\n",
    "import subprocess\ncommand = '''git'''\nsubprocess.run(command)\n",
  ]) {
    assert.equal(script_constants(text, "python").values.size, 0, text);
  }
  assert.equal(script_constants("const child_process = require('child_process');\nconst program = `git ${x}`;\nchild_process.exec(program);\n", "js").values.size, 0);
});

test("a bare-specifier import used only as a process program is an installed package", () => {
  const text = 'import { spawn } from "node:child_process";\nimport electron_path from "electron";\nconst launch = () => {\n  app = spawn(electron_path, ["."], {\n    stdio: "inherit",\n  });\n};\n';
  assert.deepEqual([...script_constants(text, "js").packages], [["electron_path", "electron"]]);
  const refs = process_refs(text, "js");
  assert.deepEqual(refs.gaps, []);
  assert.deepEqual(refs.packages, [{ written: "electron_path", spec: "electron", line: 4 }]);
  const required = script_constants('const child_process = require("child_process");\nconst tool = require("some-cli");\nchild_process.spawn(tool, []);\n', "js");
  assert.deepEqual([...required.packages], [["tool", "some-cli"]]);
});

test("a relative import binding is not a package and a package used elsewhere is not a program", () => {
  const relative = 'import { spawn } from "node:child_process";\nimport tool from "./tool.js";\nspawn(tool, []);\n';
  assert.equal(script_constants(relative, "js").packages.size, 0);
  assert.match(process_refs(relative, "js").gaps.join("\n"), /Dynamic process invocation could not be inspected: tool, \[\]/);
  const other = 'import { spawn } from "node:child_process";\nimport electron_path from "electron";\nconsole.log(electron_path);\nspawn(electron_path, []);\n';
  assert.equal(script_constants(other, "js").packages.size, 0);
  const argument = 'import { spawn } from "node:child_process";\nimport electron_path from "electron";\nspawn("node", [electron_path]);\n';
  assert.equal(script_constants(argument, "js").packages.size, 0);
});

test("constants feed literal import calls", () => {
  const python = script_constants("import importlib\nmodule_name = 'json'\nimportlib.import_module(module_name)\n", "python");
  assert.deepEqual([...python.values], [["module_name", "'json'"]]);
  const js = script_constants("const target = './plugin.js';\nrequire(target);\n", "js");
  assert.deepEqual([...js.values], [["target", "'./plugin.js'"]]);
});

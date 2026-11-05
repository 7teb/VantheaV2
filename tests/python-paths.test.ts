import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { import_folders } from "../electron/permissions/python-paths.ts";

const location = String.raw`D:\work\project`;
const script = String.raw`D:\work\project\tools\run.py`;

test("literal, Path, abspath and __file__ forms of sys.path changes resolve to folders", () => {
  const text = [
    "import os, sys",
    "from pathlib import Path",
    "sys.path.insert(0, 'lib')",
    "sys.path.insert(0,str(Path('fresh_analysis').resolve()))",
    "sys.path.append(os.path.abspath('vendor'))",
    "sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))",
    "sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'shared'))",
    "sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'more'))",
    String.raw`sys.path.append(r'C:\tools\py')`,
    "sys.path.append(os.getcwd())",
  ].join("\n");
  const found = import_folders(text, script, location);
  assert.deepEqual(found.gaps, []);
  assert.deepEqual(found.first, [path.win32.join(location, "shared"), path.win32.join(location, "tools"), path.win32.join(location, "fresh_analysis"), path.win32.join(location, "lib")]);
  assert.deepEqual(found.last, [path.win32.join(location, "vendor"), path.win32.join(location, "more"), String.raw`C:\tools\py`, location]);
});

test("a single top-level path binding resolves, a reassigned one is a visible gap", () => {
  const bound = import_folders("import sys\nfrom pathlib import Path\nROOT = Path(__file__).resolve().parents[1]  # project root\nBASE = 'lib'\nsys.path.insert(0, str(ROOT / 'src'))\nsys.path.append(BASE)\nprint(ROOT, BASE)\nfor item in ROOT.iterdir():\n    pass\n", script, location);
  assert.deepEqual(bound.gaps, []);
  assert.deepEqual(bound.first, [path.win32.join(location, "src")]);
  assert.deepEqual(bound.last, [path.win32.join(location, "lib")]);
  for (const text of ["ROOT = 'a'\nROOT = 'b'\nsys.path.insert(0, ROOT)", "ROOT = 'a'\ndef f():\n    global ROOT\nsys.path.insert(0, ROOT)", "ROOT = 'a'\nROOT += 'b'\nsys.path.insert(0, ROOT)", "ROOT = 'a'\nfor ROOT in dirs:\n    pass\nsys.path.insert(0, ROOT)"]) {
    assert.match(import_folders(text, script, location).gaps.join(""), /Import path could not be resolved: sys\.path\.insert\(0, ROOT\)/, text);
  }
});

test("anything else is a visible gap", () => {
  const unresolved = import_folders("sys.path.insert(0, os.environ['TOOLS'])\nsys.path.append(base)", "", location);
  assert.deepEqual(unresolved.first, []);
  assert.deepEqual(unresolved.gaps, [
    "Import path could not be resolved: sys.path.insert(0, os.environ['TOOLS']) in python -c code.",
    "Import path could not be resolved: sys.path.append(base) in python -c code.",
  ]);
  assert.match(import_folders("sys.path.insert(0, os.path.dirname(__file__))", "", location).gaps.join(""), /could not be resolved/);
});

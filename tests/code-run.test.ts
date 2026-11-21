import assert from "node:assert/strict";
import { test } from "node:test";
import { language_name, runnable_command } from "../src/components/code-language.ts";

const run = (language: string, code: string) => runnable_command(language_name(language), code);

test("single-line PowerShell and generic shell blocks are runnable in the terminal panel", () => {
  assert.equal(run("powershell", "Get-ChildItem -Force\n"), "Get-ChildItem -Force");
  assert.equal(run("ps1", "  npm test  "), "npm test");
  assert.equal(run("pwsh", "git status"), "git status");
  assert.equal(run("console", "dir"), "dir");
  assert.equal(run("terminal", "node -v"), "node -v");
});

test("multi-line, empty, Bash and non-shell blocks get no run button", () => {
  assert.equal(run("powershell", "cd app\nnpm test"), null);
  assert.equal(run("powershell", "cd app\r\nnpm test"), null);
  assert.equal(run("powershell", "   \n"), null);
  assert.equal(run("bash", "ls -la"), null);
  assert.equal(run("sh", "echo hi"), null);
  assert.equal(run("cmd", "dir"), null);
  assert.equal(run("typescript", "const a = 1"), null);
  assert.equal(run("", "git status"), null);
});

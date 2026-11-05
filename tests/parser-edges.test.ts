import assert from "node:assert/strict";
import { test } from "node:test";
import { read_only_command } from "../electron/permissions/allowlist.ts";
import { walk_command, type Step } from "../electron/permissions/command-walk.ts";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";
import { split_statements, statement_parts } from "../electron/permissions/statements.ts";

const floor_scope: FloorScope = { app_root: "C:\\Users\\u\\AppData\\Roaming\\VantheaX", project_root: "C:\\work", cwd: "C:\\work" };

const commands = (text: string): string[] =>
  [...walk_command(text, { location: "C:\\work", dialect: "powershell", env: {} })]
    .filter((step: Step) => step.command)
    .map((step) => step.words.map((word) => word.word.raw).join(" "));

test("cmd comment lines after CRLF or blank lines end without looping", () => {
  assert.deepEqual(statement_parts("echo a\r\nrem hi\r\necho b\r\n", "cmd").map((part) => part.text), ["echo a", "rem hi", "echo b"]);
  assert.deepEqual(statement_parts("echo a\n\n:: x\necho b", "cmd").map((part) => part.text), ["echo a", ":: x", "echo b"]);
  assert.deepEqual(statement_parts("@echo off\r\nrem Copyright\r\n@set X=1", "cmd").map((part) => part.text), ["@echo off", "rem Copyright", "@set X=1"]);
});

test("a less-than with a hash in cmd and posix words is a redirect, not an endless empty word", () => {
  assert.deepEqual(shell_words("echo a <# b", "cmd").map((word) => word.raw), ["echo", "a", "<", "#", "b"]);
  assert.deepEqual(shell_words("<# c #> Get-Item y", "cmd").map((word) => word.raw), ["<", "#", "c", "#", ">", "Get-Item", "y"]);
  assert.deepEqual(shell_words("echo <#", "posix").map((word) => word.raw), ["echo", "<"]);
});

test("comments inside a script block do not close it or hide the rest from the floor and the walk", () => {
  const hidden = "& { <# } #> Remove-Item -Recurse -Force C:\\Windows }";
  assert.match(floor_reason(hidden, floor_scope), /Windows/);
  assert.deepEqual(commands(hidden), ["Remove-Item -Recurse -Force C:\\Windows"]);
  assert.match(floor_reason("if ($true) {\n  <# } #> Remove-Item -Recurse -Force C:\\Windows\n}", floor_scope), /Windows/);
  assert.equal(read_only_command("Get-ChildItem | Sort-Object { <# } #> .\\tools\\a.ps1 }"), false);
  assert.deepEqual(commands("foreach ($i in 1..2) {\n # don't\n Write-Output $i\n}\n.\\tools\\a.ps1"), ["Write-Output $i", ".\\tools\\a.ps1"]);
  assert.deepEqual(split_statements("& { <# } #> Remove-Item x }"), ["& { <# } #> Remove-Item x }", "Remove-Item x"]);
});

test("typographic quotes open and close strings like the PowerShell tokenizer", () => {
  assert.deepEqual(commands("Write-Output 'abc\u2019; .\\tools\\a.ps1; \u2018def'"), ["Write-Output 'abc\u2019", ".\\tools\\a.ps1", "\u2018def'"]);
  assert.deepEqual(commands("Write-Output \"abc\u201d; .\\tools\\a.ps1; \u201cdef\""), ["Write-Output \"abc\u201d", ".\\tools\\a.ps1", "\u201cdef\""]);
  const [call] = [...walk_command("& \u2018.\\tools\\a.ps1\u2019", { location: "C:\\work", dialect: "powershell", env: {} })];
  assert.deepEqual(call?.words[1]?.value, { values: [".\\tools\\a.ps1"], maybe_unset: false });
  assert.deepEqual(shell_words("@\u2019\nabc\n\u2018@", "powershell")[0]?.pieces, [{ kind: "text", quote: "single_here", text: "abc" }]);
});

test("a hash right after a closing quote starts a comment", () => {
  assert.deepEqual(commands("Write-Output \"x\"# it's\n.\\tools\\a.ps1"), ["Write-Output \"x\"", ".\\tools\\a.ps1"]);
  assert.deepEqual(commands("Write-Output 'x'# it's\n.\\tools\\a.ps1"), ["Write-Output 'x'", ".\\tools\\a.ps1"]);
});

test("dash variants and glued parameter values are parameters", () => {
  assert.deepEqual(shell_words("Import-Module \u2013Name .\\m.psm1", "powershell").map((word) => word.raw), ["Import-Module", "-Name", ".\\m.psm1"]);
  assert.deepEqual(shell_words("Set-Location -Path:tools", "powershell").map((word) => [word.raw, word.glued]), [["Set-Location", false], ["-Path:", false], ["tools", true]]);
  assert.deepEqual(shell_words("Set-Location -Path: tools", "powershell").map((word) => word.raw), ["Set-Location", "-Path:", "tools"]);
  assert.deepEqual(shell_words("git --no-pager:x", "powershell").map((word) => word.raw), ["git", "--no-pager:x"]);
});

test("a dot followed by a quote, a variable or a block at command position is the dot-source operator", () => {
  for (const text of [".\".\\tools\\a.ps1\"", ".'.\\tools\\a.ps1'", ".$s"]) assert.equal(shell_words(text, "powershell")[0]?.raw, ".", text);
  assert.deepEqual(shell_words("Write-Output .x", "powershell").map((word) => word.raw), ["Write-Output", ".x"]);
});

test("stop-parsing passes the rest of the line verbatim, including semicolons", () => {
  assert.deepEqual(commands("icacls x --% /grant a; .\\tools\\a.ps1"), ["icacls x --% /grant a; .\\tools\\a.ps1"]);
  assert.deepEqual(commands("icacls x --% /grant a\n.\\tools\\a.ps1"), ["icacls x --% /grant a", ".\\tools\\a.ps1"]);
});

test("long commands are scanned in linear time", () => {
  const start = Date.now();
  statement_parts("echo " + "x".repeat(450000));
  statement_parts("echo " + "x".repeat(450000), "cmd");
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
});

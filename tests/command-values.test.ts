import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assign_variable, assignment_of, command_writes, create_values, expression_value, group_items, join_value_states, read_env, resolved, word_value, type Value,
} from "../electron/permissions/command-values.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";

const state = (vars: Record<string, string[]> = {}, env: Record<string, string> = {}, script_path = "") => {
  const values = create_values(env, script_path);
  for (const [name, list] of Object.entries(vars)) assign_variable(values, name, resolved(list));
  return values;
};

const shown = (value: Value) => ("values" in value ? value.values : value.unresolved);

const word = (text: string, values = state()) => shown(word_value(shell_words(text, "powershell")[0] ?? shell_words("''", "powershell")[0]!, values, "powershell"));

test("a variable inside a string stops at the first character outside a name", () => {
  const values = state({ x: ["a"], dir: ["C:\\x"] });
  assert.deepEqual(word(`"$x.exe"`, values), ["a.exe"]);
  assert.deepEqual(word(`"$x[0]"`, values), ["a[0]"]);
  assert.deepEqual(word(`"$dir\\probe.exe"`, values), ["C:\\x\\probe.exe"]);
  assert.deepEqual(word("${x}b", values), ["ab"]);
  assert.deepEqual(word(".\\$x.exe", values), [".\\a.exe"]);
  assert.deepEqual(word("$dir\\probe.exe", values), ["C:\\x\\probe.exe"]);
  assert.deepEqual(word("$x-y", values), ["a-y"]);
  assert.equal(word("$x.exe", values), "property access");
  assert.equal(word(`"$x".Length`, values), "property access");
  assert.equal(word(`"$dir:x"`, values), "scoped variable");
  assert.deepEqual(word("$x`.exe", values), ["a.exe"]);
});

test("a variable unset on some paths interpolates as empty but contributes nothing as a whole word", () => {
  const values = state();
  assign_variable(values, "x", { values: ["a"], maybe_unset: true });
  assert.deepEqual(word(`"$x\\b"`, values), ["a\\b", "\\b"]);
  const whole = word_value(shell_words("$x", "powershell")[0]!, values, "powershell");
  assert.deepEqual(whole, { values: ["a"], maybe_unset: true });
  assert.equal(word(`"$never\\b"`, values), "no assignment in this command");
  assert.deepEqual(word(`"$null"`, values), [""]);
});

test("Join-Path and Path.Combine follow PowerShell 5.1", () => {
  const values = state({}, { TEMP: "C:\\Temp" });
  assert.deepEqual(shown(expression_value("Join-Path 'C:\\a\\' '\\b'", values)), ["C:\\a\\b"]);
  assert.deepEqual(shown(expression_value("Join-Path -ChildPath b -Path C:\\a", values)), ["C:\\a\\b"]);
  assert.deepEqual(shown(expression_value("Join-Path $env:TEMP 'probe'", values)), ["C:\\Temp\\probe"]);
  assert.equal(shown(expression_value("Join-Path a b -Resolve -Foo x", values)), "expression not evaluated");
  assert.deepEqual(shown(expression_value("[IO.Path]::Combine('C:\\a', '\\b')", values)), ["\\b"]);
  assert.deepEqual(shown(expression_value("[System.IO.Path]::Combine('C:\\a', 'b', 'c.exe')", values)), ["C:\\a\\b\\c.exe"]);
  assert.equal(shown(expression_value("Get-Command cl", values)), "command output");
});

test("concatenation, string casts and lists", () => {
  const values = state({ x: ["a"] });
  assert.deepEqual(shown(expression_value("'Remove' + '-Item'", values)), ["Remove-Item"]);
  assert.deepEqual(shown(expression_value("$x + '.exe'", values)), ["a.exe"]);
  assert.deepEqual(shown(expression_value("[string]$x", values)), ["a"]);
  assert.equal(shown(expression_value("[string]@('a', 'b')", values)), "not a string");
  assert.equal(shown(expression_value("1 + 2", values)), "not a string");
  assert.equal(shown(expression_value("'a' -replace 'a', 'b'", values)), "expression not evaluated");
  assert.deepEqual(expression_value("@('x64', 'x86')", values), { values: ["x64", "x86"], maybe_unset: false, list: true });
  assert.deepEqual(expression_value("'a', 'b'", values), { values: ["a", "b"], maybe_unset: false, list: true });
  assert.deepEqual(expression_value("@(\n'a'\n'b'\n)", values), { values: ["a", "b"], maybe_unset: false, list: true });
  assign_variable(values, "list", expression_value("'a', 'b'", values));
  assert.equal(word(`"$list\\x"`, values), "not a string");
  assert.deepEqual(group_items("$x, '/c x'", values).map(shown), [["a"], ["/c x"]]);
});

test("more than 8 candidates make a value unresolved", () => {
  const values = state({ a: ["1", "2", "3"], b: ["4", "5", "6"] });
  assert.deepEqual(word(`"$a$b"`.replace("$b", "-"), values), ["1-", "2-", "3-"]);
  assert.equal(word(`"$a$b"`, values), "more than 8 possible values");
  assert.equal(shown(resolved(["1", "2", "3", "4", "5", "6", "7", "8", "9"])), "more than 8 possible values");
});

test("automatic variables stay unresolved except the script path in a followed script", () => {
  const values = state({}, {}, "D:\\proj\\tools\\build.ps1");
  for (const name of ["$_", "$PSItem", "$PWD", "$HOME", "$LASTEXITCODE", "$args", "$Matches"]) assert.equal(word(name, values), "automatic variable", name);
  assert.deepEqual(word(`"$PSScriptRoot\\x.exe"`, values), ["D:\\proj\\tools\\x.exe"]);
  assert.deepEqual(word("$PSCommandPath", values), ["D:\\proj\\tools\\build.ps1"]);
  assert.equal(word("$PSScriptRoot", state()), "automatic variable");
});

test("environment names read the overlay first, are case insensitive and never invent a value", () => {
  const values = state({}, { Temp: "C:\\Temp", Path: "C:\\a;C:\\b" });
  assert.deepEqual(word(`"$env:TEMP\\x"`, values), ["C:\\Temp\\x"]);
  assert.deepEqual(word("${env:temp}", values), ["C:\\Temp"]);
  assert.equal(word(`"$env:VX_UNSET\\tool.exe"`, values), "not set in the environment");
  assert.equal(word("$env:PATH", values), "holds a list of paths");
  assert.deepEqual(shown(read_env(values, "PATH", true)), ["C:\\a;C:\\b"]);
  assert.deepEqual(shown(expression_value(`"C:\\tools;$env:Path"`, values, true)), ["C:\\tools;C:\\a;C:\\b"]);
});

test("assignments are parsed with and without spaces and every other form poisons", () => {
  assert.deepEqual(assignment_of("$dir='D:\\x'"), { target: "variable", names: ["dir"], cast: "", rhs: "'D:\\x'", rhs_start: 5, append: false });
  assert.deepEqual([assignment_of("$p += ';x'")?.target, assignment_of("$p += ';x'")?.append], ["variable", true]);
  assert.equal(assignment_of("$a, $b += 1")?.target, "poison");
  assert.equal(assignment_of("$env:X = 1")?.target, "env");
  assert.equal(assignment_of("${env:X} = 1")?.target, "env");
  assert.equal(assignment_of("[string]$x = 'a'")?.cast, "[string]");
  assert.equal(assignment_of("[System.Collections.Generic.List[string]]$x = .\\a.exe")?.rhs, ".\\a.exe");
  for (const text of ["$a, $b = 1, 2", "$x -= 'a'", "$x.Name = 1", "$x[0] = 1", "$global:x = 1", "$i++"]) assert.equal(assignment_of(text)?.target, "poison", text);
  for (const text of ["$x == 1", "$x -eq 1", "$x", "[IO.File]::ReadAllBytes($x)", "Write-Output $x = 1"]) assert.equal(assignment_of(text), null, text);
});

test("a join keeps values from both paths and marks names written on one path only", () => {
  const before = state({ a: ["x"] });
  const after = state({ a: ["y"], b: ["z"] });
  const joined = join_value_states(before, after);
  assert.deepEqual(joined.vars.get("a"), { values: ["x", "y"], maybe_unset: false });
  assert.deepEqual(joined.vars.get("b"), { values: ["z"], maybe_unset: true });
});

test("variable and environment writes by commands poison what they can reach", () => {
  const args = (text: string, values: ReturnType<typeof state>) => shell_words(text, "powershell").map((entry) => ({ word: entry, value: word_value(entry, values, "powershell") }));
  const values = state({ a: ["1"], b: ["2"] }, { P: "x" });
  command_writes("set-variable", args("-Name a -Value 3", values), "Set-Variable -Name a -Value 3", values);
  assert.equal(word("$a", values), "written by set-variable");
  assert.deepEqual(word("$b", values), ["2"]);
  command_writes("remove-item", args("env:P", values), "Remove-Item env:P", values);
  assert.equal(word("$env:P", values), "written by remove-item");
  command_writes("get-childitem", args("-OutVariable o", values), "Get-ChildItem -OutVariable o", values);
  assert.equal(word("$b", values), "written by get-childitem");
  const env_values = state({}, { Q: "y" });
  command_writes("", [], "[Environment]::SetEnvironmentVariable('Q', 'z')", env_values);
  assert.equal(word("$env:Q", env_values), "written by an expression");
  assert.equal(command_writes("", [], "$ExecutionContext.SessionState.Path.SetLocation('C:\\')", state()), true);
  const all = state({ a: ["1"] });
  command_writes("set-variable", args("$name 5", all), "Set-Variable $name 5", all);
  assert.equal(word("$a", all), "written by set-variable");
});

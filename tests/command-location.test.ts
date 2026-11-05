import assert from "node:assert/strict";
import { test } from "node:test";
import { against_location, location_change, start_location, start_process_targets, type LocationState } from "../electron/permissions/command-location.ts";
import { create_values, resolved, unresolved, word_value, type Value } from "../electron/permissions/command-values.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";
import type { Dialect } from "../electron/permissions/statements.ts";

const shown = (value: Value) => ("values" in value ? value.values : value.unresolved);

const change = (statement: string, from: LocationState = start_location("D:\\proj"), dialect: Dialect = "powershell", matches?: (pattern: string) => string[]) => {
  const values = create_values({});
  const [name, ...rest] = shell_words(statement, dialect);
  const args = rest.map((word) => ({ word, value: word_value(word, values, "powershell") }));
  return location_change((name?.raw ?? "").toLowerCase(), args, from, dialect, statement, matches);
};

test("Set-Location takes -Path, -LiteralPath and a positional path", () => {
  assert.deepEqual(shown(change("Set-Location -LiteralPath 'D:\\other'")?.current ?? unresolved("none")), ["D:\\other"]);
  assert.deepEqual(shown(change("cd ..\\sibling")?.current ?? unresolved("none")), ["D:\\sibling"]);
  assert.deepEqual(shown(change("sl -Path sub -PassThru")?.current ?? unresolved("none")), ["D:\\proj\\sub"]);
  assert.equal(change("Get-ChildItem sub"), null);
});

test("a -Path wildcard resolves only with exactly one match", () => {
  const one = () => ["D:\\proj\\build-x64"];
  const two = () => ["D:\\proj\\build-x64", "D:\\proj\\build-x86"];
  assert.deepEqual(shown(change("Set-Location -Path 'build-*'", undefined, "powershell", one)?.current ?? unresolved("none")), ["D:\\proj\\build-x64"]);
  assert.equal(shown(change("Set-Location -Path 'build-*'", undefined, "powershell", two)?.current ?? unresolved("none")), "working directory unknown after: Set-Location -Path 'build-*'");
  assert.deepEqual(shown(change("Set-Location -LiteralPath 'a[1]'", undefined, "powershell", two)?.current ?? unresolved("none")), ["D:\\proj\\a[1]"]);
  assert.equal(shown(change("Set-Location 'a[1]'")?.current ?? unresolved("none")), "working directory unknown after: Set-Location 'a[1]'");
});

test("provider paths, stacks by name, history and home make the location unknown", () => {
  for (const statement of ["Set-Location HKLM:\\Software", "Set-Location Env:", "Set-Location Microsoft.PowerShell.Core\\FileSystem::C:\\x", "Push-Location x -StackName s", "cd -", "cd +", "cd ~", "Set-Location", "cd $target"]) {
    const result = change(statement);
    assert.equal(shown(result?.current ?? resolved(["unchanged"])), "working directory unknown after: " + statement, statement);
  }
});

test("Push-Location and Pop-Location keep a stack and an empty pop keeps the location", () => {
  const pushed = change("Push-Location 'D:\\proj\\tools'");
  assert.deepEqual(shown(pushed?.current ?? unresolved("none")), ["D:\\proj\\tools"]);
  const popped = change("Pop-Location", pushed ?? undefined);
  assert.deepEqual(shown(popped?.current ?? unresolved("none")), ["D:\\proj"]);
  assert.deepEqual(shown(change("Pop-Location")?.current ?? unresolved("none")), ["D:\\proj"]);
  assert.equal(shown(change("popd", { ...start_location("D:\\proj"), stack_known: false })?.current ?? unresolved("none")), "working directory unknown after: popd");
});

test("cmd cd needs /d for another drive and cd without arguments changes nothing", () => {
  assert.deepEqual(shown(change("cd /d E:\\work", undefined, "cmd")?.current ?? unresolved("none")), ["E:\\work"]);
  assert.equal(shown(change("cd E:\\work", undefined, "cmd")?.current ?? unresolved("none")), "working directory unknown after: cd E:\\work");
  assert.deepEqual(shown(change("cd Program Files", undefined, "cmd")?.current ?? unresolved("none")), ["D:\\proj\\Program Files"]);
  assert.deepEqual(shown(change("cd", undefined, "cmd")?.current ?? unresolved("none")), ["D:\\proj"]);
  assert.equal(shown(change("pushd \\\\server\\share", undefined, "cmd")?.current ?? unresolved("none")), "working directory unknown after: pushd \\\\server\\share");
});

test("relative paths resolve against every location and keep an unknown location's reason", () => {
  assert.deepEqual(shown(against_location(resolved(["a.exe", "C:\\b.exe"]), resolved(["D:\\x", "D:\\y"]))), ["D:\\x\\a.exe", "D:\\y\\a.exe", "C:\\b.exe"]);
  assert.equal(shown(against_location(resolved(["a.exe"]), unresolved("working directory unknown after: cd $t"))), "working directory unknown after: cd $t");
  assert.deepEqual(shown(against_location(resolved(["\\\\host\\share\\a.exe"]), unresolved("x"))), ["\\\\host\\share\\a.exe"]);
});

test("Start-Process looks in the location and the working directory", () => {
  const here = resolved(["D:\\proj"]);
  assert.deepEqual(shown(start_process_targets(resolved(["u.bat"]), here, resolved(["wd"]))), ["D:\\proj\\u.bat", "D:\\proj\\wd\\u.bat"]);
  assert.deepEqual(shown(start_process_targets(resolved(["C:\\Tools\\probe.exe"]), here, unresolved("not set"))), ["C:\\Tools\\probe.exe"]);
  assert.equal(shown(start_process_targets(resolved(["u.bat"]), here, unresolved("not set in the environment"))), "not set in the environment");
  assert.deepEqual(shown(start_process_targets(resolved(["u.bat"]), here, null)), ["D:\\proj\\u.bat"]);
});

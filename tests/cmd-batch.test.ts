import assert from "node:assert/strict";
import { test } from "node:test";
import { cmd_condition_body, cmd_internal, cmd_search, cmd_set, percent_expand } from "../electron/permissions/cmd-batch.ts";
import { walk_command, type Step } from "../electron/permissions/command-walk.ts";
import { create_values, type Value } from "../electron/permissions/command-values.ts";
import { shell_words } from "../electron/permissions/shell-words.ts";

const shown = (value: Value) => ("values" in value ? value.values : value.unresolved);

const batch = (text: string, script_path = "C:\\tools\\build.bat", env: Record<string, string> = { ProgramFiles: "C:\\Program Files" }) =>
  [...(walk_command(text, { location: "D:\\proj", dialect: "cmd", env, script_path }) as Iterable<Step>)];

const target = (step: Step | undefined) => shown(step?.words[cmd_internal((step?.words[0]?.word.raw ?? "").toLowerCase()) && step?.words[0]?.word.raw.toLowerCase() === "call" ? 1 : 0]?.value ?? { unresolved: "none" });

test("set feeds %NAME% on later lines but not on the same line", () => {
  const steps = batch("set TOOL=C:\\bin\\tool.exe\n%TOOL% /x\nset TOOL=C:\\other.exe & %TOOL%");
  assert.deepEqual(steps.map(target), [["C:\\bin\\tool.exe"], ["C:\\bin\\tool.exe"]]);
  assert.deepEqual(shown(percent_expand("%ProgramFiles%\\x", create_values({ programfiles: "C:\\PF" }), "")), ["C:\\PF\\x"]);
  assert.equal(shown(percent_expand("%VX_UNSET%\\x", create_values({}), "")), "not set in the environment");
});

test("%~dp0 and its relatives come from the batch file path", () => {
  const values = create_values({});
  assert.deepEqual(shown(percent_expand("%~dp0helper.bat", values, "C:\\tools\\build.bat")), ["C:\\tools\\helper.bat"]);
  assert.deepEqual(shown(percent_expand("%~nx0 %~f0 %~d0", values, "C:\\tools\\build.bat")), ["build.bat C:\\tools\\build.bat C:"]);
  assert.equal(shown(percent_expand("%~dp0x", values, "")), "batch file path unknown");
  assert.equal(shown(percent_expand("%~z0", values, "C:\\tools\\build.bat")), "file attribute expansion");
});

test("arguments, for variables, delayed expansion and substrings stay unresolved", () => {
  const values = create_values({ x: "1" });
  assert.equal(shown(percent_expand("%1\\run.exe", values, "C:\\b.bat")), "batch argument");
  assert.equal(shown(percent_expand("%*", values, "C:\\b.bat")), "batch argument");
  assert.equal(shown(percent_expand("%%i", values, "C:\\b.bat")), "for loop variable");
  assert.equal(shown(percent_expand("!X!", values, "C:\\b.bat")), "delayed expansion");
  assert.equal(shown(percent_expand("%X:~0,1%", values, "C:\\b.bat")), "substring or replacement expansion");
  assert.deepEqual(shown(percent_expand("100%%", values, "C:\\b.bat")), ["100%"]);
});

test("after a label every set is joined with the earlier value", () => {
  const steps = batch("set T=a.exe\n:again\nset T=b.exe\ncall %T%");
  assert.deepEqual(target(steps.at(-1)), ["a.exe", "b.exe"]);
  const straight = batch("set T=a.exe\nset T=b.exe\ncall %T%");
  assert.deepEqual(target(straight.at(-1)), ["b.exe"]);
  const branched = batch("set T=a.exe\nif exist x (set T=b.exe)\ncall %T%");
  assert.deepEqual(target(branched.at(-1)), ["a.exe", "b.exe"]);
});

test("cd /d moves the location and bare names search the location before PATH", () => {
  const steps = batch("cd /d E:\\work\nrun.exe\necho hi\ncall :sub\ncall helper.bat");
  assert.deepEqual(steps.map((step) => [step.words[0]?.word.raw, shown(step.location), step.command, step.search]), [
    ["cd", ["D:\\proj"], false, "none"],
    ["run.exe", ["E:\\work"], true, "location_then_path"],
    ["echo", ["E:\\work"], false, "none"],
    ["call", ["E:\\work"], true, "location_then_path"],
  ]);
  assert.equal(cmd_search("tool"), "location_then_path");
  assert.equal(cmd_search("echo"), "none");
  assert.equal(cmd_search("c:\\x\\tool.exe"), "none");
});

test("cmd blocks, if and for bodies and for command lists are walked", () => {
  const steps = batch("if exist a.txt (call one.bat) else (two.exe)\nfor /f %%a in ('lister.exe /b') do call %%a\nfor %%f in (*.txt) do type %%f");
  assert.deepEqual(steps.map((step) => step.words.map((word) => word.word.raw).join(" ")), ["call one.bat", "two.exe", "lister.exe /b", "call %%a", "type %%f"]);
  assert.equal(target(steps[3]), "for loop variable");
});

test("set forms and if conditions", () => {
  assert.deepEqual(cmd_set("set X=C:\\a b"), { name: "X", value: "C:\\a b" });
  assert.deepEqual(cmd_set('set "X=C:\\a b"'), { name: "X", value: "C:\\a b" });
  assert.deepEqual(cmd_set("set /a N=1+2"), { name: "N", poison: "set by arithmetic or input" });
  assert.equal(cmd_set("set X"), null);
  const body = (text: string) => text.slice(cmd_condition_body(shell_words(text, "cmd")));
  assert.equal(body("if exist a.txt run.exe"), "run.exe");
  assert.equal(body("if /i not %A%==x run.exe"), "run.exe");
  assert.equal(body("if %A% EQU 1 run.exe"), "run.exe");
  assert.equal(body("if errorlevel 1 run.exe"), "run.exe");
  assert.equal(body('if "%L%"==""set "L=%LIB%"'), 'set "L=%LIB%"');
  assert.equal(cmd_condition_body(shell_words("if a", "cmd")), -1);
});

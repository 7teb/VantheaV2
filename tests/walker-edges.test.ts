import assert from "node:assert/strict";
import { test } from "node:test";
import { walk_command, type Step, type Value } from "../electron/permissions/command-walk.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture_env } from "./sources-fixture.ts";

const root = "C:\\work";

const walk = (text: string, dialect: "powershell" | "cmd" = "powershell", env: Record<string, string> = {}): Step[] => [...walk_command(text, { location: root, dialect, env })];

const shown = (value: Value | undefined): string[] | string => (!value ? "none" : "values" in value ? value.values : value.unresolved);

const step_of = (steps: Step[], raw: string): Step | undefined => steps.find((step) => step.words.some((word) => word.word.raw === raw));

const target_of = (step: Step | undefined): string[] | string => shown(step?.words[step.words[0]?.word.raw === "&" || step.words[0]?.word.raw === "." ? 1 : 0]?.value);

test("a script call inside a loop keeps the location and the names it does not change", async () => {
  const setup = await fixture_env({ "run.ps1": "param($Configuration)\nWrite-Output run", "after.ps1": "Write-Output after", "move.ps1": "Set-Location tools" });
  const scope = { chat_id: "c-walk", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env };
  for (const text of ["foreach ($c in 'Debug','Release') { .\\run.ps1 -Configuration $c }; .\\after.ps1", "1..3 | % { .\\run.ps1 }; .\\after.ps1", "while ($true) { & .\\run.ps1; break }; .\\after.ps1"]) {
    const sources = await inspect_command_sources(setup.root, setup.root, text, scope);
    assert.deepEqual(sources.gaps, [], text);
    assert.deepEqual(sources.files.map((file) => file.path), ["run.ps1", "after.ps1"], text);
  }
  const moved = await inspect_command_sources(setup.root, setup.root, "foreach ($i in 1..2) { . .\\move.ps1 }; .\\after.ps1", scope);
  assert.match(moved.gaps.join("\n"), /after\.ps1 \(working directory unknown after/);
  const changing = walk("$p = 'a'; foreach ($i in 1..2) { $p = $p + 'x' }; & $p");
  assert.equal(target_of(changing.at(-1)), "changes on every loop iteration");
});

test("a location pushed inside try and popped in finally comes back", () => {
  const steps = walk("try { Push-Location tools; git status } finally { Pop-Location }; git log");
  assert.deepEqual(shown(step_of(steps, "status")?.location), [root + "\\tools"]);
  assert.deepEqual(shown(step_of(steps, "log")?.location), [root]);
  const unbalanced = walk("if ($x) { Push-Location tools }; Pop-Location; git log");
  assert.deepEqual(shown(step_of(unbalanced, "log")?.location), [root]);
});

test("push without a path, redirects on Set-Location and $PWD keep the location known", () => {
  const pushed = walk("Push-Location; Set-Location tools; git status; Pop-Location; git log");
  assert.deepEqual(shown(step_of(pushed, "status")?.location), [root + "\\tools"]);
  assert.deepEqual(shown(step_of(pushed, "log")?.location), [root]);
  assert.deepEqual(shown(step_of(walk("Set-Location tools 2>$null; git log"), "log")?.location), [root + "\\tools"]);
  assert.deepEqual(target_of(walk("& \"$PWD\\tools\\a.ps1\"")[0]), [root + "\\tools\\a.ps1"]);
  assert.deepEqual(shown(step_of(walk("Set-Location (Join-Path $PWD 'tools'); git log"), "log")?.location), [root + "\\tools"]);
});

test("appending to PATH with += keeps it resolved", () => {
  const steps = walk("$env:Path += ';C:\\vc\\bin'; ml64 /c x.asm", "powershell", { PATH: "C:\\Windows" });
  assert.deepEqual(shown(steps.at(-1)?.state.values.env.get("path")), ["C:\\Windows;C:\\vc\\bin"]);
  const list = walk("$a = @('x'); $a += 'y'; & $a");
  assert.equal(target_of(list.at(-1)), "not a string");
});

test("cmd /c strips quotes around command lines, keeps them around a quoted program path, and /S always strips", () => {
  const payload = (text: string) => shown(walk(text).find((step) => step.payload)?.payload?.value);
  assert.deepEqual(payload('cmd /c "node tools\\x.js"'), ["node tools\\x.js"]);
  assert.deepEqual(payload('cmd /s /c "call tools\\x.bat"'), ["call tools\\x.bat"]);
  assert.deepEqual(payload('cmd /c "if errorlevel 1 tools\\x.bat"'), ["if errorlevel 1 tools\\x.bat"]);
  assert.deepEqual(payload('cmd /c "C:\\Program Files\\x\\vcvars64.bat"'), ['"C:\\Program Files\\x\\vcvars64.bat"']);
  assert.deepEqual(payload('cmd /s /c "C:\\Program Files\\x\\vcvars64.bat"'), ["C:\\Program Files\\x\\vcvars64.bat"]);
});

test("cmd /r, a glued /c and a leading stop-parsing token carry the payload, other arguments are unresolved", () => {
  const payload = (text: string) => shown(walk(text).find((step) => step.payload)?.payload?.value);
  assert.deepEqual(payload("cmd /r tools\\x.bat"), ["tools\\x.bat"]);
  assert.deepEqual(payload("cmd /ctools\\x.bat"), ["tools\\x.bat"]);
  assert.deepEqual(payload("cmd --% /c echo a & tools\\x.bat"), ["echo a & tools\\x.bat"]);
  assert.equal(payload("cmd tools\\x.bat"), "cmd argument is neither a switch nor /c, /k or /r");
});

test("cmd for loop variables in command-line and batch form are unresolved", () => {
  const argument = (text: string) => shown(walk(text, "cmd").find((step) => step.words[0]?.word.raw === "call")?.words[1]?.value);
  assert.equal(argument("for /r tools %f in (*.bat) do call %f"), "for loop variable");
  assert.equal(argument("for %f in (*.bat) do call %~ff"), "for loop variable");
  assert.equal(argument("for /f %i in ('dir /b tools\\*.bat') do call tools\\%i"), "for loop variable");
  assert.equal(argument("for %%f in (*.bat) do call %%~ff"), "for loop variable");
});

test("a glued cmd IF operand still finds the command after the closing quote", () => {
  const steps = walk('if "%X%"==""set "X=1"\r\ncall %X%.bat', "cmd");
  assert.deepEqual(shown(steps.at(-1)?.words[1]?.value), ["1.bat"]);
});

test("labeled loops, invoked blocks and a block passed to powershell -Command are walked once", () => {
  const labeled = walk(":outer foreach ($f in 'a.ps1','b.ps1') { & \".\\tools\\$f\" }");
  assert.deepEqual(target_of(labeled.at(-1)), [".\\tools\\a.ps1", ".\\tools\\b.ps1"]);
  assert.deepEqual(walk("{ .\\tools\\a.ps1 }.Invoke()").map((step) => step.text), [".\\tools\\a.ps1"]);
  const block = walk("powershell -Command { .\\tools\\a.ps1 }");
  assert.deepEqual(shown(block[0]?.payload?.value), [" .\\tools\\a.ps1 "]);
  assert.deepEqual(block.filter((step) => step.text === ".\\tools\\a.ps1").map((step) => step.depth), [1]);
});

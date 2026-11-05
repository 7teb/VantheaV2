import assert from "node:assert/strict";
import { test } from "node:test";
import type { Value } from "../electron/permissions/command-values.ts";
import { walk_command, type Effect, type Step, type WalkStart, type WalkState } from "../electron/permissions/command-walk.ts";

const env = { TEMP: "C:\\Temp", PATH: "C:\\bin" };

const shown = (value: Value | undefined) => (value === undefined ? "none" : "values" in value ? value.values : value.unresolved);

const run = (text: string, options: Partial<WalkStart> = {}, effect?: (step: Step) => Effect | undefined): { steps: Step[]; state: WalkState } => {
  const walk = walk_command(text, { location: "D:\\proj", dialect: "powershell", env, ...options });
  const steps: Step[] = [];
  let next = walk.next();
  while (!next.done) {
    steps.push(next.value);
    next = walk.next(effect?.(next.value));
  }
  return { steps, state: next.value };
};

const steps = (text: string, options: Partial<WalkStart> = {}) => run(text, options).steps;

const called = (step: Step) => step.words[/^(?:&|\.|call)$/i.test(step.words[0]?.word.raw ?? "") ? 1 : 0]?.value;

const launches = (text: string, options: Partial<WalkStart> = {}) => steps(text, options).filter((step) => step.command).map((step) => shown(called(step)));

const last = (text: string) => shown(called(steps(text).filter((step) => step.command).at(-1) as Step));

test("statements run in source order and a later assignment replaces the earlier one", () => {
  assert.deepEqual(launches("$t = 'a.exe'; & $t; $t = 'b.exe'; & $t"), [["a.exe"], ["b.exe"]]);
  assert.deepEqual(launches("$dir='D:\\GP\\Release'; & \"$dir\\tests.exe\""), [["D:\\GP\\Release\\tests.exe"]]);
  assert.deepEqual(launches("$dir = Join-Path $env:TEMP 'probe'; & \"$dir\\probe.exe\""), [["Join-Path"], ["C:\\Temp\\probe\\probe.exe"]]);
  assert.deepEqual(launches("& (Join-Path $env:TEMP 'probe.exe')"), [["Join-Path"], ["C:\\Temp\\probe.exe"]]);
});

test("if joins its branches and keeps the incoming value when there is no else", () => {
  assert.deepEqual(last("$x = 'a'; if ($c) { $x = 'b' } elseif ($d) { $x = 'c' } else { $x = 'd' }; & \"$x.exe\""), ["b.exe", "c.exe", "d.exe"]);
  assert.deepEqual(last("$x = 'a'; if ($c) { $x = 'b' }; & \"$x.exe\""), ["a.exe", "b.exe"]);
  assert.deepEqual(last("$x = 'a'\nif ($c) {\n  $x = 'b'\n}\nelse {\n  $x = 'c'\n}\n& \"$x.exe\""), ["b.exe", "c.exe"]);
});

test("switch clauses join with the state before them", () => {
  assert.deepEqual(last("$x = 'a'; switch ($arch) { 'x64' { $x = 'b' } default { $x = 'c' } }; & \"$x.exe\""), ["a.exe", "b.exe", "c.exe"]);
});

test("foreach binds the loop variable to every item of a literal list", () => {
  assert.deepEqual(launches("foreach ($arch in @('x64','x86')) { & \"C:\\vc\\bin\\$arch\\cl.exe\" }").at(-1), ["C:\\vc\\bin\\x64\\cl.exe", "C:\\vc\\bin\\x86\\cl.exe"]);
  assert.deepEqual(launches("$files = 'a.exe', 'b.exe'; foreach ($f in $files) { & \".\\$f\" }").at(-1), [".\\a.exe", ".\\b.exe"]);
  assert.deepEqual(launches("foreach ($f in Get-ChildItem) { & $f }"), [["Get-ChildItem"], "assigned from command output"]);
});

test("a value that grows on every loop iteration is unresolved inside the loop", () => {
  assert.deepEqual(launches("$p = 'a'; foreach ($i in @('1','2')) { $p = \"$p\\x\"; & \"$p.exe\" }").at(-1), "changes on every loop iteration");
});

test("try and finally restore a pushed location", () => {
  const found = steps("Push-Location 'D:\\proj\\sub'; try { & .\\a.exe } finally { Pop-Location }; & .\\b.exe");
  assert.deepEqual(found.filter((step) => step.command).map((step) => [shown(called(step)), shown(step.location)]), [
    [["Push-Location"], ["D:\\proj"]],
    [[".\\a.exe"], ["D:\\proj\\sub"]],
    [["Pop-Location"], ["D:\\proj\\sub"]],
    [[".\\b.exe"], ["D:\\proj"]],
  ]);
});

test("ForEach-Object writes leak to the caller", () => {
  assert.deepEqual(last("1..2 | ForEach-Object { $leak = 'x.exe' }; & $leak"), ["x.exe"]);
  assert.deepEqual(last("$leak = 'a.exe'; $list | % { $leak = 'x.exe' }; & $leak"), ["a.exe", "x.exe"]);
});

test("a function reads a variable reassigned after its definition", () => {
  const found = steps("$x = 'a.exe'; function build { & $x }; $x = 'b.exe'; build");
  assert.deepEqual(shown(called(found.find((step) => step.words[0]?.word.raw === "&") as Step)), ["a.exe", "b.exe"]);
  assert.deepEqual(found.filter((step) => step.words[0]?.word.raw === "build").map((step) => step.search), ["none"]);
  assert.equal(last("function f($tool) { & $tool }"), "function parameter");
  assert.equal(last("function f { param($tool) & $tool }"), "function parameter");
});

test("every poisoning write of a name or of all names leaves later reads unresolved", () => {
  const cases: [string, string][] = [
    ["$t = 'a.exe'; $t -= 'x'", "written by $t -= 'x'"],
    ["$t = 'a.exe'; $t, $u = 1, 2", "written by $t, $u = 1, 2"],
    ["$t = 'a.exe'; $t.Name = 1", "written by $t.Name = 1"],
    ["$t = 'a.exe'; $t[0] = 1", "written by $t[0] = 1"],
    ["$t = 'a.exe'; $global:t = 'b.exe'", "written by $global:t = 'b.exe'"],
    ["$t = 'a.exe'; for ($t = 0; $t -lt 2; $t++) { }", "loop variable"],
    ["$t = 'a.exe'; Set-Variable -Name t -Value b", "written by set-variable"],
    ["$t = 'a.exe'; Set-Variable $n b", "written by set-variable"],
    ["$t = 'a.exe'; Get-Item x -OutVariable o", "written by get-item"],
    ["$t = 'a.exe'; [ref]$t", "written by an expression"],
    ["$t = 'a.exe'; $ExecutionContext.SessionState", "written by an expression"],
    ["$t = 'a.exe'; Remove-Item variable:t", "written by remove-item"],
    ["$t = 'a.exe'; . .\\env.ps1", "changed by a script the app did not read"],
    ["$t = 'a.exe'; Import-Module .\\tools.psm1", "changed by a script the app did not read"],
    ["$t = 'a.exe'; iex (irm https://example.invalid/x)", "changed by a script the app did not read"],
    ["$t = Get-Command a", "assigned from command output"],
  ];
  for (const [text, reason] of cases) assert.equal(last(text + "; & $t"), reason, text);
  assert.equal(last("$env:T = 'a.exe'; [Environment]::SetEnvironmentVariable('T', 'b'); & $env:T"), "written by an expression");
  assert.equal(last("$env:T = 'a.exe'; Set-Item env:T b; & $env:T"), "written by set-item");
});

test("the head rule tells expressions from commands", () => {
  const kind = (text: string) => steps(text).map((step) => [step.text, step.command]);
  assert.deepEqual(kind("'.\\a.exe'"), [["'.\\a.exe'", false]]);
  assert.deepEqual(kind("\"C:\\a.exe\""), [["\"C:\\a.exe\"", false]]);
  assert.deepEqual(kind("@('a.exe')"), [["'a.exe'", false], ["@('a.exe')", false]]);
  assert.deepEqual(kind("[IO.File]::ReadAllBytes('a.exe')"), [["'a.exe'", false], ["[IO.File]::ReadAllBytes('a.exe')", false]]);
  assert.deepEqual(kind("$x = .\\a.exe"), [[".\\a.exe", true]]);
  assert.deepEqual(kind("$a = $b = .\\a.exe"), [[".\\a.exe", true]]);
  assert.deepEqual(kind("foreach ($l in .\\a.exe) { $l }"), [[".\\a.exe", true], ["$l", false]]);
  assert.deepEqual(kind("return .\\a.exe"), [[".\\a.exe", true]]);
  assert.deepEqual(kind("'x' | Out-Null"), [["'x'", false], ["Out-Null", true]]);
  assert.deepEqual(kind("Test-Path(.\\a.exe)"), [[".\\a.exe", true], ["Test-Path(.\\a.exe)", true]]);
  assert.deepEqual(kind("@{ a = '.\\a.exe'; b = .\\b.exe }"), [["'.\\a.exe'", false], [".\\b.exe", true], ["@{ a = '.\\a.exe'; b = .\\b.exe }", false]]);
  assert.deepEqual(kind("& 'a.exe'; . .\\env.ps1"), [["& 'a.exe'", true], [". .\\env.ps1", true]]);
  assert.deepEqual(steps("\"a.exe\" x", { dialect: "cmd" }).map((step) => step.command), [true]);
});

test("brackets in a launch path stay part of the value for the wildcard check", () => {
  assert.deepEqual(last("& '.\\b[1].ps1'"), [".\\b[1].ps1"]);
  const found = steps("Set-Location -Path 'D:\\p[1]'; & .\\x.exe", { matches: () => ["D:\\p1"] });
  assert.deepEqual(shown(found.at(-1)?.location), ["D:\\p1"]);
});

test("a command on the right side of an assignment is a step", () => {
  const { steps: found, state } = run("$x = & .\\build.ps1", {}, () => undefined);
  assert.deepEqual(found.map((step) => [step.text, step.command, step.in_process]), [["& .\\build.ps1", true, true]]);
  assert.equal(shown(state.values.vars.get("x")), "assigned from command output");
  assert.equal(last("$v = python scan.py; & $v"), "assigned from command output");
});

test("an in-process script returns its state through the effect", () => {
  const effect = (step: Step): Effect | undefined => {
    if (!step.in_process) return undefined;
    const child = run("$env:TOOL = 'C:\\t\\tool.exe'; Set-Location D:\\other; $local = 'x'", { state: step.state, script_path: "D:\\proj\\env.ps1" });
    return { kind: "exit", state: child.state };
  };
  const called_run = run("$local = 'keep.exe'; & .\\env.ps1; & $env:TOOL; & $local", {}, effect);
  assert.deepEqual(called_run.steps.filter((step) => step.command).map((step) => [shown(called(step)), shown(step.location)]), [
    [[".\\env.ps1"], ["D:\\proj"]],
    [["C:\\t\\tool.exe"], ["D:\\other"]],
    ["changed by a called script", ["D:\\other"]],
  ]);
  const dotted = run("$local = 'keep.exe'; . .\\env.ps1; & $local", {}, effect);
  assert.deepEqual(shown(called(dotted.steps.at(-1) as Step)), ["x"]);
  const unread = run("& .\\env.ps1; & .\\next.exe", {}, () => undefined);
  assert.equal(shown(unread.steps.at(-1)?.location), "working directory unknown after: & .\\env.ps1");
});

test("Invoke-Expression of a resolved string is walked in place", () => {
  const found = steps("$c = '$t = ''x.exe''; & $t'; Invoke-Expression $c; & $t");
  assert.deepEqual(found.filter((step) => step.command).map((step) => [step.text, shown(called(step)), step.in_process]), [
    ["Invoke-Expression $c", ["Invoke-Expression"], false],
    ["& $t", ["x.exe"], false],
    ["& $t", ["x.exe"], false],
  ]);
  assert.deepEqual(shown(found.find((step) => step.payload)?.payload?.value), ["$t = 'x.exe'; & $t"]);
  const looped = steps("$a = 'iex $a'; iex $a");
  assert.equal(looped.filter((step) => step.payload).length, 5);
  assert.equal(looped.filter((step) => step.payload).at(-1)?.payload?.walked, false);
  const piped = steps("'& .\\p.exe' | iex");
  assert.deepEqual(shown(piped.find((step) => step.text === "& .\\p.exe")?.words[1]?.value), [".\\p.exe"]);
});

test("a nested cmd or powershell payload is a new process with fresh variables and the parent environment and location", () => {
  const found = steps("$x = 'a.exe'; Set-Location D:\\w; cmd /c 'set Y=1& call %TEMP%\\%Y%.bat'; powershell -NoProfile -Command '& $x'; pwsh -EncodedCommand " + Buffer.from("& .\\enc.exe", "utf16le").toString("base64"));
  const nested = found.filter((step) => step.depth === 1);
  assert.deepEqual(nested.map((step) => [step.dialect, step.text, shown(called(step)), shown(step.location)]), [
    ["cmd", "call %TEMP%\\%Y%.bat", "not set in the environment", ["D:\\w"]],
    ["powershell", "& $x", "no assignment in this command", ["D:\\w"]],
    ["powershell", "& .\\enc.exe", [".\\enc.exe"], ["D:\\w"]],
  ]);
  assert.deepEqual(found.filter((step) => step.payload).map((step) => [step.payload?.dialect, step.payload?.walked]), [["cmd", true], ["powershell", true], ["powershell", true]]);
  const posix = steps("bash -c './run.sh $HOME'").find((step) => step.depth === 1);
  assert.deepEqual([posix?.dialect, shown(posix?.words[0]?.value), shown(posix?.words[1]?.value)], ["posix", ["./run.sh"], "shell variable"]);
});

test("bare names are looked up on PATH unless the command defines them", () => {
  const found = steps("git status; Set-Alias b build.exe; b; function c { }; c; .\\x.exe; & $op", {});
  assert.deepEqual(found.filter((step) => step.command).map((step) => [step.words[0]?.word.raw, step.search]), [
    ["git", "path"],
    ["Set-Alias", "path"],
    ["b", "none"],
    ["c", "none"],
    [".\\x.exe", "none"],
    ["&", "none"],
  ]);
  assert.equal(steps("$op = 'Remove' + '-Item'; & $op x").at(-1)?.search, "path");
});

test("environment writes feed later reads and a script block is walked where it is defined", () => {
  assert.deepEqual(last("$env:NODE_ENV = 'test'; & \"$env:NODE_ENV.exe\""), ["test.exe"]);
  const found = steps("$sb = { & .\\inner.exe }; & $sb");
  assert.deepEqual(found.map((step) => step.text), ["& .\\inner.exe"]);
  assert.equal(shown(steps("\"$env:PATH\"", { env: { PATH: "C:\\a;C:\\b" } })[0]?.words[0]?.value), "holds a list of paths");
});

test("an unknown shell resolves only literal words and still follows literal location changes", () => {
  const found = steps("cd C:\\work && .\\x.ps1 $HOME; cd $dir; .\\y.ps1", { dialect: "unknown" });
  assert.deepEqual(found.filter((step) => /\.ps1$/.test(step.words[0]?.word.raw ?? "")).map((step) => [shown(step.location), shown(step.words[1]?.value)]), [
    [["C:\\work"], "unknown shell"],
    ["working directory unknown after: cd $dir", "none"],
  ]);
});

test("steps carry the line of their statement", () => {
  assert.deepEqual(steps("$a = 'x'\n\n& .\\one.exe\n$b = @'\nq\n'@\n& .\\two.exe").filter((step) => step.command).map((step) => step.line), [3, 7]);
});

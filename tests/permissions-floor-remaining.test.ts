import assert from "node:assert/strict";
import child_process from "node:child_process";
import { before, test, type TestContext } from "node:test";
import type { PermissionMode } from "../shared/chat.ts";
import type { CommandInput } from "../electron/permissions/decide.ts";
import type { Reviewer } from "../electron/tools/types.ts";
import { load_policy, policy_reviews, reviewed_with_gap, unresolved_expectation, type Policy } from "./policy-stub.ts";

let policy: Policy;

before(async () => {
  policy = await load_policy();
});

const prepare = (context: TestContext) => {
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    context.mock.method(child_process, name, () => { throw new Error("Pure policy must never start a process"); });
  context.mock.method(child_process.ChildProcess.prototype as unknown as { spawn: (...args: unknown[]) => unknown }, "spawn", () => { throw new Error("Pure policy must never start a process"); });
  const drive = process.env.SystemDrive;
  process.env.SystemDrive = "C:";
  context.after(() => { if (drive === undefined) delete process.env.SystemDrive; else process.env.SystemDrive = drive; });
};
const decide = (command: string, mode: PermissionMode = "full") => policy.decide_command({ command, mode, shell: "powershell", background: false, plan: false,
  app_root: "C:/Users/fixture/AppData/Roaming/VantheaX", project_root: "D:/project", cwd: "D:/project", chat_id: "remaining-floor", chat_started_at: 0, call_id: "fixture", profile: "main",
  custom_instructions: "", decisions: [], last_human_id: null, changed: [], } satisfies CommandInput,
  { actor: { id: "main", name: "Main", kind: "main" } } as Reviewer, new AbortController().signal);

const blocked = [
  'Remove-Item "$env:SystemDrive\\Windows" -Recurse',
  'Remove-Item "${env:SystemDrive}\\Windows" -Recurse',
  '$drive="$env:SystemDrive"; Remove-Item "$drive\\Windows" -Recurse',
  'Remove-Item C:\\Win* -Recurse',
  'Remove-Item C:\\W?ndows\\Temp -Recurse',
  'Remove-Item C:\\[Ww]in* -Recurse',
  'Remove-Item -Path C:\\Windo[w]s -Recurse',
  "$ExecutionContext.InvokeCommand.InvokeScript('Remove-Item C:\\Windows -Recurse')",
  "$ExecutionContext.InvokeCommand.InvokeScript(('Remove'+'-Item C:\\Windows -Recurse'))",
  "$target='C:\\Windows'; $ExecutionContext.InvokeCommand.InvokeScript('Remove-Item $target -Recurse')",
  "$ExecutionContext.InvokeCommand.InvokeScript(\"& ('Remove'+'-Item') C:\\Windows\")",
  "$ExecutionContext.InvokeCommand.'InvokeScript'('Remove-Item C:\\Windows')",
  "$ExecutionContext.InvokeCommand.('Invoke'+'Script')('Remove-Item C:\\Windows')",
];
for (const [index, command] of blocked.entries()) for (const mode of ["full", "auto", "ask"] as const)
  test(`remaining static floor blocks protected case ${index} in ${mode}`, async (context) => {
    prepare(context);
    assert.equal((await decide(command, mode)).action, "block");
  });

for (const command of [
  "$ExecutionContext.InvokeCommand.InvokeScript($unknown)",
  "$ExecutionContext.InvokeCommand.InvokeScript($false, $unknown, $null)",
  "$invoker.InvokeScript('Remove-Item C:\\Windows')",
  "$env:SystemDrive='D:/project'; [Environment]::SetEnvironmentVariable('SystemDrive','C:','Process'); Remove-Item \"$env:SystemDrive/Windows\" -Recurse",
  "$env:SystemDrive='D:/project'; Set-Item Env:SystemDrive C:; Remove-Item \"$env:SystemDrive/Windows\" -Recurse",
  "$ExecutionContext.SessionState.Path.SetLocation('C:/'); Remove-Item Windows -Recurse",
  "[IO.File]::Delete($unknown)",
  "[IO.Directory]::Delete($unknown, $true)",
  "$unknown | Remove-Item -Recurse",
  "Get-Content paths.txt | Remove-Item -Recurse",
])
  for (const mode of ["full", "auto", "ask"] as const) test(`unresolved script invocation follows the ${mode} mode ${JSON.stringify(command)}`, async (context) => {
    prepare(context);
    const before_count = policy_reviews().length;
    assert.equal((await decide(command, mode)).action, unresolved_expectation(mode));
    assert.equal(policy_reviews().length - before_count, mode === "auto" ? 1 : 0);
    if (mode === "auto") assert.ok(reviewed_with_gap());
  });

for (const command of [
  'Remove-Item C:\\Win\\* -Recurse',
  'Remove-Item C:\\Wine* -Recurse',
  'Remove-Item C:\\Project*\\Windows -Recurse',
  'Remove-Item -LiteralPath C:\\Windo[w]s -Recurse',
  "[IO.Directory]::Delete('C:\\Windo[w]s', $true)",
  '$env:SystemDrive="D:\\project"; Remove-Item "$env:SystemDrive\\Windows" -Recurse',
  "$ExecutionContext.InvokeCommand.InvokeScript('Write-Output hello')",
  "Write-Output '$ExecutionContext.InvokeCommand.InvokeScript'",
  "$ExecutionContext.InvokeCommand.InvokeScript",
  "$stamp=[DateTime]::Now.ToString(); Remove-Item D:/project/build -Recurse",
  "$target='D:/project/out'; Remove-Item $target",
  "$target='D:/project/out'; [IO.File]::Delete($target)",
  "'D:/project/out' | Remove-Item",
  "$ExecutionContext.SessionState.Path.SetLocation('C:/'); Remove-Item D:/project/out",
  "[Environment]::SetEnvironmentVariable('SystemDrive','C:','Process'); [IO.File]::Delete('D:/project/out')",
  "Set-Alias short Write-Output; Remove-Item D:/project/build -Recurse",
]) test(`ordinary disjoint or data-only Full case remains usable ${JSON.stringify(command)}`, async (context) => {
  prepare(context);
  assert.equal((await decide(command)).action, "run");
});

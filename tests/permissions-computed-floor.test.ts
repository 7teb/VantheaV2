import assert from "node:assert/strict";
import child_process from "node:child_process";
import { before, test, type TestContext } from "node:test";
import type { PermissionMode } from "../shared/chat.ts";
import type { CommandInput } from "../electron/permissions/decide.ts";
import type { Reviewer } from "../electron/tools/types.ts";
import { load_policy, policy_reviews, reviewed_with_gap, unresolved_expectation, type Policy } from "./policy-stub.ts";

let policy: Policy;
const signal = () => new AbortController().signal;
const reviewer = { actor: { id: "main", name: "Main", kind: "main" } } as Reviewer;
const input = (command: string, mode: PermissionMode = "full"): CommandInput => ({
  command, mode, shell: "powershell", background: false, plan: false, app_root: "C:\\Users\\fixture\\AppData\\Roaming\\VantheaX",
  project_root: "D:\\project", cwd: "D:\\project", chat_id: "computed-policy", chat_started_at: 0, call_id: "fixture", profile: "main",
  custom_instructions: "", decisions: [], last_human_id: null, changed: [],
});

before(async () => {
  policy = await load_policy();
});

const no_processes = (context: TestContext) => {
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    context.mock.method(child_process, name, () => { throw new Error("Policy tests must never start a process"); });
  context.mock.method(child_process.ChildProcess.prototype as unknown as { spawn: (...args: unknown[]) => unknown }, "spawn", () => { throw new Error("Policy tests must never start a process"); });
};

const protected_target = "C:\\Windows";
const blocked = [
  "& ('Remove'+'-Item') -Recurse -Force " + protected_target,
  "& (('Re' + 'move') + '-Item') " + protected_target,
  "$verb='Remove'+'-Item'; & $verb " + protected_target,
  "$prefix='Remove'; & ($prefix+'-Item') " + protected_target,
  "$target='" + protected_target + "'; & ('Remove'+'-Item') $target",
  "cd C:\\; & ('Remove'+'-Item') Windows",
  "& ('r'+'m') " + protected_target,
  "& (\"Re`move\"+'-Item') " + protected_target,
  "& ('Microsoft.PowerShell.Management\\'+'Remove-Item') " + protected_target,
  "iex ('Remove'+'-Item " + protected_target + "')",
  "powershell -Command \"& ('Remove'+'-Item') " + protected_target + "\"",
  "$target='" + protected_target + "'; iex ('[IO.Directory]::' + 'Delete($target, $true)')",
  "& $unknown; Remove-Item " + protected_target,
];

for (const [index, command] of blocked.entries()) for (const mode of ["full", "auto", "ask"] as const)
  test(`pure policy blocks resolved protected operation ${index} in ${mode}`, async (context) => {
    no_processes(context);
    const decision = await policy.decide_command(input(command, mode), reviewer, signal());
    assert.equal(decision.action, "block");
    assert.equal(decision.record?.source, "floor");
  });

for (const command of ["& $unknown argument", ". $unknown", "& (Get-Content command-name.txt) argument", "iex $unknown", "$verb='Write-Output'; . ./unknown.ps1; & $verb argument", "Set-Alias Write-Output Remove-Item; & 'Write-Output' C:/Windows", "$env:VX_HEAD='Write-Output'; [Environment]::SetEnvironmentVariable('VX_HEAD','Remove-Item','Process'); & $env:VX_HEAD C:/Windows"])
  for (const mode of ["full", "auto", "ask"] as const) test(`an unresolved invocation follows the ${mode} mode ${JSON.stringify(command)}`, async (context) => {
    no_processes(context);
    const before_count = policy_reviews().length;
    assert.equal((await policy.decide_command(input(command, mode), reviewer, signal())).action, unresolved_expectation(mode));
    assert.equal(policy_reviews().length - before_count, mode === "auto" ? 1 : 0);
    if (mode === "auto") assert.ok(reviewed_with_gap());
  });

for (const command of [
  "& ('Write'+'-Output') hello",
  "$verb='Write'+'-Output'; & $verb hello",
  "& ('Write'+'-Output') 'Remove-Item C:\\Windows'",
  "& ('Remove'+'-Item') D:\\project\\build -Recurse",
  "& ('C:\\tools\\Remove-'+'Item.exe') C:\\Windows",
  "& 'Write-Output' hello",
  "& { Write-Output hello }",
  "npm run build",
  "$path=[System.IO.Path]::Combine('D:\\project','out'); & ('Write'+'-Output') $path",
  "$number=0; & ('Write'+'-Output') hello",
]) test(`pure policy preserves known ordinary Full invocation ${JSON.stringify(command)}`, async (context) => {
  no_processes(context);
  assert.equal((await policy.decide_command(input(command), reviewer, signal())).action, "run");
});

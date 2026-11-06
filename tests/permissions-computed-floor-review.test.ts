import assert from "node:assert/strict";
import child_process from "node:child_process";
import { before, test } from "node:test";
import type { CommandInput } from "../electron/permissions/decide.ts";
import type { Reviewer } from "../electron/tools/types.ts";
import { load_policy, policy_reviews, reviewed_with_gap, type Policy } from "./policy-stub.ts";

let policy: Policy;

before(async () => {
  policy = await load_policy();
});

const input = (command: string): CommandInput => ({
  command,
  mode: "auto",
  shell: "powershell",
  background: false,
  plan: false,
  app_root: "C:/Users/fixture/AppData/Roaming/VantheaX",
  project_root: "D:/project",
  cwd: "D:/project",
  chat_id: "independent-policy",
  chat_started_at: 0,
  call_id: "fixture",
  profile: "main",
  custom_instructions: "",
  decisions: [],
  last_human_id: null,
  changed: [],
});

const cases = [
  ["literal alias shadows a computed friendly head", "Set-Alias Write-Output Remove-Item; & ('Write'+'-Output') C:/Windows"],
  ["computed alias setter shadows a later friendly head", "& ('Set'+'-Alias') Write-Output Remove-Item; & ('Write'+'-Output') C:/Windows"],
  ["function shadows a computed friendly head", "function Write-Output { param($x) Remove-Item $x }; & ('Write'+'-Output') C:/Windows"],
  ["computed variable setter invalidates the prior friendly value", "$verb='Write-Output'; & ('Set'+'-Variable') verb Remove-Item; & $verb C:/Windows"],
  ["computed location setter changes relative protected target", "& ('Set'+'-Location') C:/; & ('Remove'+'-Item') Windows"],
  ["computed variable provider setter invalidates the prior value", "$verb='Write-Output'; & ('Set'+'-Item') Variable:verb Remove-Item; & $verb C:/Windows"],
  ["named alias parameters cannot hide the shadowed friendly name", "Set-Alias -Value Remove-Item -Name Write-Output; & ('Write'+'-Output') C:/Windows"],
  ["function provider mutation cannot hide the shadowed friendly name", "Set-Item Function:Write-Output { param($x) Remove-Item $x }; & ('Write'+'-Output') C:/Windows"],
  ["qualified computed location setter changes the relative protected target", "& ('Microsoft.PowerShell.Management\\'+'Set-Location') C:/; & ('Remove'+'-Item') Windows"],
] as const;

for (const [name, command] of cases) {
  test("in auto mode the floor blocks, or the review learns it could not resolve, when " + name, async (context) => {
    for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
      context.mock.method(child_process, method, () => {
        throw new Error("Independent policy tests must never start a process");
      });
    }
    context.mock.method(child_process.ChildProcess.prototype as unknown as { spawn: (...args: unknown[]) => unknown }, "spawn", () => {
      throw new Error("Independent policy tests must never start a process");
    });

    const before_count = policy_reviews().length;
    const decision = await policy.decide_command(input(command), { actor: { id: "main", name: "Main", kind: "main" } } as Reviewer, new AbortController().signal);
    if (decision.action === "block") {
      return;
    }

    assert.equal(policy_reviews().length - before_count, 1, name);
    assert.ok(reviewed_with_gap(), name);
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { walk_command, type Step } from "../electron/permissions/command-walk.ts";
import { split_statements } from "../electron/permissions/statements.ts";
import { floor_reason } from "../electron/permissions/floor.ts";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture_env, native_bytes } from "./sources-fixture.ts";

const collect = (text: string, dialect: "powershell" | "cmd" | "posix" = "powershell"): Step[] => {
  const walk = walk_command(text, { dialect, location: String.raw`D:\project`, env: { TEMP: String.raw`C:\Temp`, PATH: String.raw`C:\bin` } });
  const steps: Step[] = [];
  let current = walk.next();
  while (!current.done) {
    steps.push(current.value);
    current = walk.next(undefined);
  }
  return steps;
};

for (const invocation of [
  "powershell.exe 'Write-Output VX_IMPLICIT'",
  "powershell.exe -NoProfile 'Write-Output VX_IMPLICIT'",
  "powershell.exe -NoLogo -NonInteractive -ExecutionPolicy Bypass 'Write-Output VX_IMPLICIT'",
  "powershell.exe -NoProfile Write-Output VX_IMPLICIT",
  "& 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -NoProfile 'Write-Output VX_IMPLICIT'",
]) {
  test(`walks Windows PowerShell implicit command ${invocation}`, () => {
    const steps = collect(invocation);
    assert.equal(steps.some((step) => step.depth === 1 && step.command && step.words[0]?.word.raw === "Write-Output" && step.text.includes("VX_IMPLICIT")), true);
  });
}

test("Windows PowerShell implicit command retains following command flags as payload", () => {
  const steps = collect("powershell.exe -NoProfile Write-Output '-File' '-Command' '-NoProfile'");
  const launch = steps.find((step) => step.payload);
  assert.ok(launch?.payload && "values" in launch.payload.value);
  assert.deepEqual(launch.payload.value.values, ["Write-Output -File -Command -NoProfile"]);
});

test("explicit File and pwsh default File are not treated as inline code", () => {
  for (const text of ["powershell.exe -NoProfile -File .\\test.ps1", "pwsh.exe -NoProfile .\\test.ps1"]) {
    assert.equal(collect(text).some((step) => step.payload), false, text);
  }
});

test("explicit Command and EncodedCommand retain their existing behavior", () => {
  const encoded = Buffer.from("Write-Output VX_ENCODED", "utf16le").toString("base64");
  for (const text of ["powershell.exe -Command 'Write-Output VX_COMMAND'", `powershell.exe -EncodedCommand ${encoded}`, "pwsh.exe -Command 'Write-Output VX_COMMAND'"]) {
    assert.equal(collect(text).some((step) => step.depth === 1 && step.command && step.words[0]?.word.raw === "Write-Output"), true, text);
  }
});

test("implicit Windows PowerShell commands are followed from cmd callers", () => {
  assert.equal(collect('powershell.exe -NoProfile "Write-Output VX_CMD"', "cmd").some((step) => step.depth === 1 && step.words[0]?.word.raw === "Write-Output"), true);
});

test("the direct floor follows the same implicit PowerShell payload", () => {
  const scope = { app_root: String.raw`C:\Users\floor-user\AppData\Roaming\VantheaX`, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
  for (const command of [
    "powershell.exe 'Remove-Item C:\\Windows -Recurse'",
    "powershell.exe -NoProfile 'Remove-Item C:\\Windows -Recurse'",
    "& 'C:\\Program Files\\Legacy PowerShell\\powershell.exe' -NoProfile 'Remove-Item C:\\Windows -Recurse'",
    "powershell.exe '-NoProfile' '-Command' 'Remove-Item C:\\Windows -Recurse'",
  ]) assert.match(floor_reason(command, scope), /deleting Windows/, command);
  assert.deepEqual(split_statements("pwsh.exe -NoProfile .\\test.ps1 -Command 'Remove-Item C:\\Windows -Recurse'"), ["pwsh.exe -NoProfile .\\test.ps1 -Command 'Remove-Item C:\\Windows -Recurse'"]);
  assert.deepEqual(split_statements("powershell.exe -File .\\test.ps1 -Command 'Remove-Item C:\\Windows -Recurse'"), ["powershell.exe -File .\\test.ps1 -Command 'Remove-Item C:\\Windows -Recurse'"]);
});

test("Windows PowerShell really executes a positional Command without -Command", { skip: process.platform !== "win32" }, () => {
  const child = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "Write-Output VX_POSITIONAL_COMMAND"], { windowsHide: true, encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "VX_POSITIONAL_COMMAND");
});

test("POSIX cross-shell checks use the same PowerShell value switches and default mode", () => {
  const app_root = String.raw`C:\Users\floor-user\AppData\Roaming\VantheaX`;
  const scope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
  for (const command of [
    `powershell.exe -NoProfile -WindowStyle Hidden 'Remove-Item ${app_root} -Recurse'`,
    `powershell.exe -InputFormat Text 'Remove-Item ${app_root} -Recurse'`,
    `powershell.exe '-NoProfile' '-Command' 'Remove-Item ${app_root} -Recurse'`,
  ]) assert.match(floor_reason(command, scope, "posix"), /VantheaX's own chats/, command);
  for (const command of [
    `powershell.exe -File ./test.ps1 -Command 'Remove-Item ${app_root} -Recurse'`,
    `pwsh.exe -NoProfile ./test.ps1 -Command 'Remove-Item ${app_root} -Recurse'`,
  ]) assert.equal(floor_reason(command, scope, "posix"), "", command);
});

test("implicit commands are inspected as inline source rather than a missing script file", async () => {
  const setup = await fixture_env();
  await fs.writeFile(path.join(setup.bin, "powershell.exe"), native_bytes());
  for (const text of ["powershell.exe -NoProfile 'Write-Output VX_INSPECTED'", "powershell.exe -NoProfile 'Write-Output sample.ps1'"]) {
    const inspected = await inspect_command_sources(setup.root, setup.root, text, { chat_id: "powershell-default", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env, shell: "powershell" });
    assert.deepEqual(inspected.gaps, [], text);
  }
});

for (const flag of ["-sta", "-mta", "-NoProfile"]) {
  test(`Windows PowerShell accepts ${flag} without consuming its positional command`, { skip: process.platform !== "win32" }, () => {
    const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", flag, "Write-Output VX_FLAG_COMMAND"], { windowsHide: true, encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "VX_FLAG_COMMAND");
    assert.equal(collect(`powershell.exe ${flag} 'Write-Output VX_FLAG_COMMAND'`).some((step) => step.depth === 1 && step.command && step.words[0]?.word.raw === "Write-Output"), true);
    const scope = { app_root: "", project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
    assert.match(floor_reason(`powershell.exe ${flag} 'Remove-Item C:/Windows -Recurse'`, scope), /deleting Windows/);
  });
}

for (const flag of ["-SettingsFile", "-WorkingDirectory"]) {
  test(`WinPS does not consume pwsh-only ${flag} as a value switch`, { skip: process.platform !== "win32" }, () => {
    const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", flag, "Write-Output VX_FIRST; Write-Output VX_SECOND"], { windowsHide: true, encoding: "utf8", timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), "VX_SECOND");
    assert.equal(collect(`powershell.exe ${flag} 'Write-Output VX_FIRST; Write-Output VX_SECOND'`).some((step) => step.depth === 1 && step.text.includes("VX_SECOND")), true);
    const app_root = String.raw`C:\Users\floor-user\AppData\Roaming\VantheaX`;
    const scope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
    assert.match(floor_reason(`powershell.exe ${flag} 'Write-Output VX_FIRST; Remove-Item ${app_root} -Recurse'`, scope), /VantheaX's own chats/);
  });
}

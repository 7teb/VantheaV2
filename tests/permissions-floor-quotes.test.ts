import assert from "node:assert/strict";
import { test } from "node:test";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";

const scope: FloorScope = { app_root: String.raw`C:\Users\user\AppData\Roaming\VantheaX`, project_root: String.raw`C:\Users\user\project`, cwd: String.raw`C:\Users\user\project` };

const powershell_literals = [
  "rg -n 'Clear-Disk' .",
  'rg -n "Clear-Disk" electron',
  "Select-String -Path *.ts -Pattern 'Format-Volume'",
  'Write-Output "Clear-Disk"',
  'git commit -m "Block Clear-Disk in the floor"',
  "rg -n 'Initialize-Disk|Reset-PhysicalDisk' .",
  "rg -n 'vssadmin delete shadows' .",
  "rg -n 'cipher /w' .",
  'rg -n "reg delete HKLM" .',
  'rg -n "x format C:" .',
  'rg -n "foo Remove-Item C:\\Windows" .',
  "rg -n 'Clear-Disk' . | Select-Object -First 5",
  "rg -n 'Clear-Disk' . 2>&1",
];

const powershell_blocked = [
  "Clear-Disk -Number 1",
  "& 'Clear-Disk' -Number 1",
  'powershell -c "Clear-Disk -Number 1"',
  "iex 'Clear-Disk -Number 1'",
  "Get-Help Clear-Disk",
  "Remove-Item \"C:\\Windows\\System32\" -Recurse",
  "vssadmin delete shadows /all",
  "$c = 'Clear-Disk'; & $c -Number 1",
  '"$(Clear-Disk -Number 1)"',
  "[scriptblock]::Create('Clear-Disk -Number 1').Invoke()",
  "New-Alias wipe 'Clear-Disk'; wipe -Number 1",
  'reg delete "HKLM\\Software\\Example" /f',
  "rg 'x' .; Clear-Disk -Number 1",
  "Start-Process powershell -ArgumentList 'Clear-Disk -Number 1'",
  "Invoke-Command -ScriptBlock { Clear-Disk -Number 1 }",
  "rg -n 'x' . | ForEach-Object { 'Clear-Disk' }",
];

const posix_literals = [
  "rg -n 'vssadmin delete shadows' .",
  'grep -rn "cipher /w" .',
  'git commit -m "block diskpart in the floor"',
  'rg -n "reg delete HKLM" .',
  "grep -rn 'x format C:' .",
];

const posix_blocked = [
  "vssadmin delete shadows /all",
  "eval 'vssadmin delete shadows /all'",
  'bash -c "diskpart /s script.txt"',
  'echo "$(diskpart /s script.txt)"',
  "echo `diskpart /s script.txt`",
  'reg delete "HKLM\\Software\\Example" /f',
  'dd if=/dev/zero of="/dev/sda"',
  "echo $'a\\' b' ; diskpart /s script.txt",
  "sh -c 'cipher /w:c'",
  'rm -rf "/c/Windows"',
];

test("the powershell floor treats quoted command names as text", () => {
  for (const command of powershell_literals) {
    assert.equal(floor_reason(command, scope, "powershell"), "", command);
  }
});

test("the powershell floor still blocks executed and unquoted command names", () => {
  for (const command of powershell_blocked) {
    assert.notEqual(floor_reason(command, scope, "powershell"), "", command);
  }
});

test("the posix floor treats quoted command names as text", () => {
  for (const command of posix_literals) {
    assert.equal(floor_reason(command, scope, "posix"), "", command);
  }
});

test("the posix floor still blocks executed and unquoted command names", () => {
  for (const command of posix_blocked) {
    assert.notEqual(floor_reason(command, scope, "posix"), "", command);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";

const floor_scope: FloorScope = { app_root: "C:\\Users\\user\\AppData\\Roaming\\VantheaX", project_root: "C:\\Users\\user\\project", cwd: "C:\\Users\\user\\project" };

const blocked = [
  "format c:",
  "format /q /fs:ntfs d:",
  "diskpart",
  "diskpart /s script.txt",
  "bcdedit /delete {current}",
  "Clear-Disk -Number 0 -RemoveData",
  "Format-Volume -DriveLetter C",
  "Initialize-Disk -Number 1",
  "Remove-Item C:\\Windows -Recurse -Force",
  "Remove-Item C:\\Windows\\System32\\kernel32.dll",
  "rm C:\\Windows -r",
  "del C:\\Windows\\System32\\drivers\\etc\\hosts",
  "rd /s /q C:\\Windows",
  "rmdir /s C:\\Program Files",
  "Remove-Item %SystemRoot% -Recurse",
  "Remove-Item $env:windir -Recurse",
  "Remove-Item C:\\ -Recurse -Force",
  "Remove-Item \"C:\\\" -Recurse",
  "del C:\\Boot\\BCD",
  "reg delete HKLM\\SOFTWARE\\Microsoft /f",
  "reg delete \"HKEY_LOCAL_MACHINE\\SYSTEM\" /f",
  "Remove-Item HKLM:\\SOFTWARE\\Foo -Recurse",
];

const harmless = [
  "npm install",
  "Remove-Item dist -Recurse -Force",
  "Remove-Item .\\build\\out.js",
  "rm node_modules -r",
  "Format-Table",
  "Get-ChildItem C:\\Windows",
  "dir C:\\Windows\\System32",
  "Get-Content 'C:\\Program Files\\foo\\bar.txt'",
  "git status",
  "Remove-Item C:\\Users\\user\\project\\old.txt",
  "node build.js",
  "del report-system32-backup.log",
  "echo formatting complete",
  "npm run build | Select-String error",
];

test("legacy floor matrix still blocks", () => {
  for (const command of blocked) {
    assert.notEqual(floor_reason(command, floor_scope), "", command);
  }
});

test("legacy harmless commands still run", () => {
  for (const command of harmless) {
    assert.equal(floor_reason(command, floor_scope), "", command);
  }
});

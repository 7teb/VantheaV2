import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";

const appdata = process.env.APPDATA ?? String.raw`C:\Users\user\AppData\Roaming`;

const app_root = path.win32.join(appdata, "VantheaX");

const workspace = path.win32.join(app_root, "v2", "workspaces", "chat1");

const legacy = path.win32.join(app_root, "workspace", "My Chat");

const reason = "deleting or moving VantheaX's own chats, media or settings";

const in_workspace: FloorScope = { app_root, project_root: workspace, cwd: workspace };

const in_project: FloorScope = { app_root, project_root: String.raw`C:\Users\user\project`, cwd: String.raw`C:\Users\user\project` };

const blocked: [string, FloorScope][] = [
  [String.raw`Remove-Item -Recurse "$env:APPDATA\VantheaX"`, in_project],
  [String.raw`rd /s /q %APPDATA%\VantheaX`, in_project],
  [`Remove-Item -Recurse -Force ${path.win32.join(app_root, "v2", "chats")}`, in_project],
  [String.raw`$target = "$env:APPDATA\VantheaX\v2"; Remove-Item -Recurse $target`, in_project],
  [String.raw`Move-Item "$env:APPDATA\VantheaX\v2\media" D:\backup\media`, in_project],
  [String.raw`Get-ChildItem "$env:APPDATA\VantheaX\v2\media\attachments" | Remove-Item -Force`, in_project],
  [String.raw`Set-Location $env:APPDATA; Remove-Item -Recurse VantheaX`, in_project],
  [String.raw`$null = Remove-Item -Recurse "$env:APPDATA\VantheaX"`, in_project],
  [String.raw`Remove-Item ("$env:APPDATA" + "\VantheaX") -Recurse`, in_project],
  [String.raw`powershell -NoProfile -Command "Remove-Item -Recurse $env:APPDATA\VantheaX"`, in_project],
  [String.raw`Rename-Item "$env:APPDATA\VantheaX" VantheaX-old`, in_project],
  [String.raw`Remove-Item -Recurse ..\..\media`, in_workspace],
  [`Remove-Item ${path.win32.join(workspace, "..", "..", "settings.json")}`, in_workspace],
  [`Remove-Item -Recurse ${path.win32.join(app_root, "v2", "workspaces", "chat2", "build")}`, in_workspace],
  [`Remove-Item -Recurse -Force "${workspace}"`, in_workspace],
  ["Remove-Item -Recurse -Force .", in_workspace],
  [String.raw`Remove-Item -Recurse "$($env:APPDATA)\VantheaX"`, in_project],
  [String.raw`Remove-Item -Recurse "$( $env:APPDATA )\VantheaX\v2\$name"`, in_project],
  [String.raw`Get-ChildItem "$env:APPDATA\VantheaX\v2\media" | Where-Object { $_.Length -gt 0 } | Remove-Item`, in_project],
  [String.raw`Get-ChildItem "$env:APPDATA\VantheaX\v2\media" | ForEach-Object { Remove-Item $_.FullName -Force }`, in_project],
  [String.raw`"$env:APPDATA\VantheaX" | Remove-Item -Recurse`, in_project],
  [String.raw`foreach ($f in @("$env:APPDATA\VantheaX\v2\media")) { Remove-Item -Recurse $f }`, in_project],
  [String.raw`Get-Item "$env:APPDATA\VantheaX\settings.json" | Move-Item -Destination D:\backup`, in_project],
];

const allowed: [string, FloorScope][] = [
  [`Remove-Item -Recurse "${path.win32.join(workspace, "build")}"`, in_workspace],
  ["Remove-Item -Recurse build", in_workspace],
  [`Remove-Item -Recurse "${path.win32.join(legacy, "build")}"`, { app_root, project_root: legacy, cwd: legacy }],
  [`Get-ChildItem ${path.win32.join(workspace, "build")} | Remove-Item -Recurse`, in_workspace],
  [`if (Test-Path ${path.win32.join(workspace, "out")}) { Remove-Item -Recurse ${path.win32.join(workspace, "out")} }`, in_workspace],
  [String.raw`Copy-Item "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png" .\input.png`, in_project],
  [String.raw`Get-Content "$env:APPDATA\VantheaX\v2\settings.json"`, in_project],
  ["Remove-Item -Recurse dist", in_project],
  [String.raw`Move-Item .\a.txt .\b.txt`, in_project],
  [String.raw`Copy-Item "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png" .\assets\menu-src.png -PassThru | Rename-Item -NewName menu.png`, in_project],
  [String.raw`Copy-Item "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png" .\tmp.png -PassThru | Move-Item -Destination .\assets\menu.png`, in_project],
  [String.raw`if (Test-Path "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png") { Remove-Item .\old.png }`, in_project],
  [String.raw`foreach ($f in @("$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png")) { Copy-Item $f .\a.png; ren .\a.png b.png }`, in_project],
  [String.raw`python tool.py "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png" --mode move`, in_project],
  [String.raw`Select-String -Pattern del "$env:APPDATA\VantheaX\v2\media\attachments\att_a_b.txt"`, in_project],
  [String.raw`Get-ChildItem "$env:APPDATA\VantheaX\v2\media\attachments" | ForEach-Object { Copy-Item $_.FullName .\assets }`, in_project],
  ["Get-ChildItem | Remove-Item -Recurse -Force", in_workspace],
];

test("deleting or moving VantheaX's own data is blocked in every spelling the floor resolves", () => {
  for (const [command, scope] of blocked) {
    assert.equal(floor_reason(command, scope), reason, command);
  }
});

test("work inside the chat's own project folder and reads or copies of the app data are not blocked", () => {
  for (const [command, scope] of allowed) {
    assert.equal(floor_reason(command, scope), "", command);
  }
});

test("a worktree chat may delete inside its worktree but never the worktrees folder itself", () => {
  const worktrees = path.win32.join(app_root, "v2", "worktrees");
  const tree = path.win32.join(worktrees, "0a1b2c3d", "shop");
  const in_worktree: FloorScope = { app_root, project_root: tree, cwd: tree };
  assert.equal(floor_reason(`Remove-Item -Recurse -Force "${path.win32.join(tree, "dist")}"`, in_worktree), "");
  assert.equal(floor_reason("Remove-Item -Recurse build", in_worktree), "");
  assert.equal(floor_reason(`Remove-Item -Recurse -Force "${worktrees}"`, in_worktree), reason);
  assert.equal(floor_reason(`Remove-Item -Recurse -Force "${path.win32.join(worktrees, "ffffffff")}"`, in_worktree), reason);
  assert.equal(floor_reason(`Remove-Item "${path.win32.join(worktrees, "ledger.json")}"`, in_worktree), reason);
});

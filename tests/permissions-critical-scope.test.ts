import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { floor_reason } from "../electron/permissions/floor.ts";
import { app_reason, hits_app, type FloorScope } from "../electron/permissions/floor-shared.ts";

const app_root = String.raw`C:\Users\floor-user\AppData\Roaming\VantheaX`;
const project = path.win32.join(app_root, "v2", "workspaces", "chat1");
const targets = [app_root, path.win32.join(app_root, "v2", "settings.json"), path.win32.join(app_root, "v2", "chats")];
const parents = ["C:\\", String.raw`C:\Users`, String.raw`C:\Users\floor-user`, path.win32.dirname(app_root), app_root];

for (const project_root of parents) {
  test(`the app-data floor survives project root ${project_root}`, () => {
    const scope: FloorScope = { app_root, project_root, cwd: project_root };
    for (const target of targets) {
      assert.equal(hits_app(target, scope), true, target);
      assert.equal(floor_reason(`Remove-Item -Recurse -Force '${target}'`, scope), app_reason, target);
      assert.equal(floor_reason(`rm -rf '${target.replaceAll("\\", "/")}'`, scope, "posix"), app_reason, target);
    }
  });
}

test("app-data protection handles normalized parent projects and casing", () => {
  const scope: FloorScope = { app_root: app_root.toUpperCase() + "\\", project_root: String.raw`c:/Users/floor-user/project/..`, cwd: String.raw`C:\Users\floor-user` };
  const target = path.win32.join(app_root, "v2", "chats", "..", "settings.json");
  assert.equal(hits_app(target, scope), true);
  assert.equal(floor_reason(`Remove-Item '${target}'`, scope), app_reason);
});

test("only descendants of a nested app-data project are exempt, never its root or siblings", () => {
  const scope: FloorScope = { app_root, project_root: project, cwd: project };
  assert.equal(hits_app(path.win32.join(project, "build"), scope), false);
  assert.equal(hits_app(project, scope), true);
  assert.equal(hits_app(path.win32.join(project, "..", "chat2", "build"), scope), true);
  assert.equal(hits_app(path.win32.join(app_root + "-other", "v2", "chats"), scope), false);
  assert.equal(hits_app(path.win32.join(app_root, "v2", "chats"), { ...scope, project_root: "" }), true);
  assert.equal(hits_app(null, scope), false);
  assert.equal(hits_app(app_root, { ...scope, app_root: "" }), false);
});

test("removing an ancestor of app data is protected as well", () => {
  const parent = path.win32.dirname(app_root);
  const scope: FloorScope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
  assert.equal(hits_app(parent, scope, true), true);
  assert.equal(floor_reason(`Remove-Item -Recurse '${parent}'`, scope), app_reason);
  assert.equal(floor_reason(`rm -rf '${parent.replaceAll("\\", "/")}'`, scope, "posix"), app_reason);
});

test("a nonrecursive parent file listing is not treated as the app-data subtree", () => {
  const home = String.raw`C:\Users\floor-user`;
  const scope: FloorScope = { app_root, project_root: home, cwd: home };
  assert.equal(floor_reason("Get-ChildItem . -File -Filter '*.tmp' | Remove-Item", scope), "");
  assert.equal(floor_reason(`Move-Item .\\out.txt '${home}'`, scope), "");
});

test("moving or renaming an app-data parent protects only the source, not an unrelated destination", () => {
  const parent = path.win32.dirname(app_root);
  const home = String.raw`C:\Users\floor-user`;
  const scope: FloorScope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
  for (const command of [
    `Move-Item '${parent}' 'D:\\archive'`,
    `Move-Item -LiteralPath '${parent}' -Destination 'D:\\archive'`,
    `Rename-Item '${parent}' 'Roaming-old'`,
    `Rename-Item -Path '${parent}' -NewName 'Roaming-old'`,
  ]) assert.equal(floor_reason(command, scope), app_reason, command);
  assert.equal(floor_reason(`Move-Item -Destination '${home}' .\\out.txt`, scope), "");
  assert.equal(floor_reason(`Move-Item .\\out.txt '${home}'`, scope), "");
  assert.equal(floor_reason("mv '/c/Users/floor-user/AppData/Roaming' /d/archive", scope, "posix"), app_reason);
  assert.equal(floor_reason("mv -t /d/archive '/c/Users/floor-user/AppData/Roaming'", scope, "posix"), app_reason);
  assert.equal(floor_reason("mv ./out.txt /c/Users/floor-user", scope, "posix"), "");
});

for (const [name, command, dialect] of [
  ["a literal pipeline parent", `'${path.win32.dirname(app_root)}' | Remove-Item -Recurse -Force`, "powershell"],
  ["Get-Item pipeline parent", `Get-Item '${path.win32.dirname(app_root)}' | Remove-Item -Recurse -Force`, "powershell"],
  ["a recursive parent listing", `Get-ChildItem '${path.win32.dirname(app_root)}' -Recurse | Remove-Item -Recurse -Force`, "powershell"],
  ["a parent directory listing", `Get-ChildItem '${path.win32.dirname(app_root)}' -Directory | Remove-Item -Recurse -Force`, "powershell"],
  ["a home directory listing", `Get-ChildItem 'C:\\Users\\floor-user' -Directory | Remove-Item -Recurse -Force`, "powershell"],
  ["an echoed parent value", `Write-Output '${path.win32.dirname(app_root)}' | Remove-Item -Recurse -Force`, "powershell"],
  ["recursive find deletion", `find '${path.win32.dirname(app_root).replaceAll("\\", "/")}' -delete`, "posix"],
] as const) {
  test(`parent sources remain protected through ${name}`, () => {
    const scope: FloorScope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
    assert.equal(floor_reason(command, scope, dialect), app_reason);
  });
}

test("pipeline sources use cwd and variables from their execution point", () => {
  const home = String.raw`C:\Users\floor-user`;
  const parent = path.win32.dirname(app_root);
  const scope: FloorScope = { app_root, project_root: home, cwd: home };
  assert.equal(floor_reason("Get-Item .\\AppData\\Roaming | Remove-Item -Recurse -Force; Set-Location D:\\project", scope), app_reason);
  assert.equal(floor_reason(`$source = '${parent}'; Get-Item $source | Remove-Item -Recurse -Force; $source = 'D:\\project'`, scope), app_reason);
  assert.equal(floor_reason(`Get-Item .\\VantheaX | Remove-Item -Recurse -Force; Set-Location '${parent}'`, scope), "");
  assert.equal(floor_reason(`$source = 'D:\\project'; Get-Item $source | Remove-Item -Recurse -Force; $source = '${parent}'`, scope), "");
});

test("non-head pipeline shell payloads retain direct app-data protection", () => {
  const scope: FloorScope = { app_root, project_root: String.raw`D:\project`, cwd: String.raw`D:\project` };
  assert.equal(floor_reason(`Write-Output ok | powershell.exe -Command 'Remove-Item ${app_root.replaceAll("\\", "/")} -Recurse'`, scope), app_reason);
  assert.equal(floor_reason("Write-Output ok | powershell.exe -Command 'Remove-Item D:/project/out -Recurse'", scope), "");
});

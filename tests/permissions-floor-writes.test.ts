import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { decide_command, type CommandInput } from "../electron/permissions/decide.ts";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";
import { app_write_reason } from "../electron/permissions/floor-shared.ts";
import { review_stub } from "./review-stub.ts";

const appdata = process.env.APPDATA ?? String.raw`C:\Users\user\AppData\Roaming`;

const desktop_root = path.win32.join(appdata, "VantheaX");

const data_dir = String.raw`D:\vx-headless\run1`;

const user_data = path.win32.join(data_dir, "data");

const app_dir = String.raw`D:\vx-app\VantheaX`;

const project = String.raw`C:\Users\user\project`;

const scratchpad = String.raw`C:\Users\user\AppData\Local\Temp\VantheaX\scratchpad\chat1`;

const workspace = path.win32.join(user_data, "v2", "workspaces", "chat1");

const roots = [user_data, data_dir, app_dir, desktop_root];

const headless: FloorScope = { app_roots: roots, project_root: project, cwd: project, guard_writes: true };

const headless_workspace: FloorScope = { app_roots: roots, project_root: workspace, cwd: workspace, guard_writes: true };

const desktop_scopes: FloorScope[] = [
  { app_roots: [desktop_root], project_root: project, cwd: project },
  { app_roots: roots, project_root: project, cwd: project },
];

const to_msys = (win: string) => `/${win[0]?.toLowerCase()}${win.slice(2).replace(/\\/g, "/")}`;

const powershell_roots = [String.raw`$env:APPDATA\VantheaX`, desktop_root, data_dir, user_data, app_dir];

const cmd_roots = [String.raw`%APPDATA%\VantheaX`, data_dir, app_dir];

const posix_roots = ["$APPDATA/VantheaX", to_msys(desktop_root), to_msys(data_dir), to_msys(app_dir), app_dir.replace(/\\/g, "/")];

const powershell_writes = (root: string): string[] => [
  String.raw`Set-Content "${root}\v2\settings.json" '{}'`,
  String.raw`sc "${root}\v2\settings.json" x`,
  String.raw`Add-Content -Path "${root}\v2\log.txt" -Value x`,
  String.raw`ac -LiteralPath "${root}\v2\log.txt" x`,
  String.raw`'x' | Out-File "${root}\v2\out.txt"`,
  String.raw`Out-File -FilePath "${root}\v2\out.txt" -InputObject x -Append`,
  String.raw`New-Item -ItemType File -Path "${root}\v2\new.txt" -Force`,
  String.raw`ni "${root}\v2\skills\evil" -ItemType Directory`,
  String.raw`New-Item -Path "${root}" -Name v2\new.txt -Value x`,
  String.raw`Copy-Item .\evil.json "${root}\v2\settings.json"`,
  String.raw`cp .\evil.json "${root}\v2\settings.json" -Force`,
  String.raw`copy .\evil.json "${root}\v2\settings.json"`,
  String.raw`Copy-Item -Path .\evil.json -Destination "${root}\v2"`,
  String.raw`'x' | Tee-Object -FilePath "${root}\v2\tee.txt"`,
  String.raw`Set-Item -Path "${root}\v2\item" -Value x`,
  String.raw`'x' > "${root}\v2\settings.json"`,
  String.raw`Get-Content .\a.txt >> "${root}\v2\log.txt"`,
  String.raw`npm test 2> "${root}\v2\err.txt"`,
];

const cmd_writes = (root: string): string[] => [
  String.raw`cmd /c "copy /y evil.json ${root}\v2\settings.json"`,
  String.raw`cmd /c "xcopy /y evil.json ${root}\v2"`,
  String.raw`cmd /c "robocopy D:\evil ${root}\v2 /E"`,
  String.raw`cmd /c "echo {} > ${root}\v2\settings.json"`,
  String.raw`cmd /c "type nul >> ${root}\v2\log.txt"`,
  String.raw`xcopy /s /y D:\evil ${root}\v2`,
  String.raw`robocopy D:\evil ${root} /MIR`,
];

const posix_writes = (root: string): string[] => [
  `echo x > "${root}/v2/settings.json"`,
  `echo x >> "${root}/v2/log.txt"`,
  `npm test 2> "${root}/v2/err.txt"`,
  `echo x | tee "${root}/v2/tee.txt"`,
  `echo x | tee -a "${root}/v2/tee.txt"`,
  `cp evil.json "${root}/v2/settings.json"`,
  `cp -t "${root}/v2" evil.json`,
  `install -m 644 evil.json "${root}/v2/settings.json"`,
  `touch "${root}/v2/new.txt"`,
  `mkdir -p "${root}/v2/skills/evil"`,
  `dd if=evil.json of="${root}/v2/settings.json"`,
  `sed -i 's/a/b/' "${root}/v2/settings.json"`,
  `sed -i.bak -e 's/a/b/' "${root}/v2/settings.json"`,
];

const indirect_powershell = [
  String.raw`Set-Location $env:APPDATA\VantheaX; Set-Content settings.json x`,
  String.raw`cd ${user_data}; New-Item -ItemType File v2\x.txt`,
  String.raw`$d = "$env:APPDATA\VantheaX"; Set-Content "$d\settings.json" x`,
  String.raw`$p = Join-Path $env:APPDATA 'VantheaX'; Set-Content "$p\settings.json" x`,
  String.raw`Set-Content (Join-Path '${data_dir}' 'data\v2\settings.json') x`,
  String.raw`Set-Content "$env:APPDATA\VantheaX\v2\$name.json" x`,
  String.raw`cmd /c "cd /d %APPDATA%\VantheaX & echo x > settings.json"`,
  String.raw`Copy-Item -Recurse D:\evil\VantheaX $env:APPDATA`,
  `bash -c 'echo x > "$APPDATA/VantheaX/settings.json"'`,
];

const indirect_posix = [
  'cd "$APPDATA/VantheaX" && echo x > settings.json',
  'D="$APPDATA/VantheaX"; cp evil.json "$D/settings.json"',
  'echo x > "$UNSET/AppData/Roaming/VantheaX/settings.json"',
  'cp -r /d/evil/VantheaX "$APPDATA"',
  String.raw`cmd //c "copy evil.json %APPDATA%\VantheaX\settings.json"`,
  String.raw`powershell -Command 'Set-Content $env:APPDATA\VantheaX\settings.json x'`,
];

const blocked_powershell = [
  ...powershell_roots.flatMap(powershell_writes),
  ...cmd_roots.flatMap(cmd_writes),
  ...indirect_powershell,
  String.raw`mkdir ${data_dir}\extra`,
];

const blocked_posix = [...posix_roots.flatMap(posix_writes), ...indirect_posix];

test("a headless run cannot write into the instance data dir, the app dir or %APPDATA%\\VantheaX from PowerShell or cmd", () => {
  for (const command of blocked_powershell) {
    assert.equal(floor_reason(command, headless), app_write_reason, command);
  }
});

test("a headless run cannot write into the app data roots from Git Bash", () => {
  for (const command of blocked_posix) {
    assert.equal(floor_reason(command, headless, "posix"), app_write_reason, command);
  }
});

test("headless writes inside the project and the scratchpad are not blocked", () => {
  const powershell = [
    String.raw`Set-Content .\a.txt x`,
    String.raw`Set-Content .\notes.txt "$env:APPDATA\VantheaX"`,
    "New-Item -ItemType Directory build",
    String.raw`Copy-Item D:\x\a.txt .`,
    String.raw`Copy-Item -Recurse D:\src .\vendor`,
    "echo x > out.txt",
    "npm test > out.log 2>&1",
    `cmd /c "copy a.txt b.txt"`,
    String.raw`robocopy D:\src .\vendor /E`,
    "echo x > $null",
    String.raw`Set-Content "${scratchpad}\probe.txt" x`,
    String.raw`Copy-Item .\a.txt "${scratchpad}"`,
    String.raw`'x' > "${scratchpad}\out.txt"`,
  ];
  for (const command of powershell) {
    assert.equal(floor_reason(command, headless), "", command);
  }
  const posix = ["echo x > ./out.txt", "sed -i 's/a/b/' ./a.txt", "mkdir -p build/out", "touch ./a.txt", "echo x > /dev/null", "cp -r /d/src ./vendor", `cp a.txt "${to_msys(scratchpad)}/a.txt"`];
  for (const command of posix) {
    assert.equal(floor_reason(command, headless, "posix"), "", command);
  }
});

test("a headless project inside the data dir may be written but its parents may not", () => {
  for (const command of [String.raw`Set-Content .\a.txt x`, String.raw`Copy-Item -Recurse D:\src .`, "echo x > out.txt"]) {
    assert.equal(floor_reason(command, headless_workspace), "", command);
  }
  for (const command of ["cp -r /d/src .", "echo x > ./out.txt"]) {
    assert.equal(floor_reason(command, headless_workspace, "posix"), "", command);
  }
  for (const command of [String.raw`Set-Content ..\..\settings.json x`, "Copy-Item x.txt ..", String.raw`Set-Content "${path.win32.join(user_data, "v2", "settings.json")}" x`]) {
    assert.equal(floor_reason(command, headless_workspace), app_write_reason, command);
  }
  assert.equal(floor_reason("echo x > ../../settings.json", headless_workspace, "posix"), app_write_reason);
});

test("headless reads of the app data and of other paths are not blocked", () => {
  const powershell = [
    String.raw`Get-Content "$env:APPDATA\VantheaX\v2\settings.json"`,
    String.raw`Copy-Item "$env:APPDATA\VantheaX\v2\media\attachments\img_a_b.png" .\input.png`,
    String.raw`type "%APPDATA%\VantheaX\v2\settings.json" > .\copy.json`,
    String.raw`Select-String foo ${user_data}\v2\settings.json`,
    String.raw`Get-ChildItem ${app_dir}`,
    String.raw`Get-Content D:\data\notes.txt`,
  ];
  for (const command of powershell) {
    assert.equal(floor_reason(command, headless), "", command);
  }
  const posix = ['cp "$APPDATA/VantheaX/v2/settings.json" ./copy.json', 'cat "$APPDATA/VantheaX/v2/settings.json" | tee ./copy.json', `sed 's/a/b/' "$APPDATA/VantheaX/v2/settings.json" > ./out.json`, "cat /d/data/notes.txt"];
  for (const command of posix) {
    assert.equal(floor_reason(command, headless, "posix"), "", command);
  }
});

test("outside headless the same writes stay unblocked, the desktop floor is unchanged", () => {
  for (const scope of desktop_scopes) {
    for (const command of blocked_powershell) {
      assert.equal(floor_reason(command, scope), "", command);
    }
    for (const command of blocked_posix) {
      assert.equal(floor_reason(command, scope, "posix"), "", command);
    }
  }
});

const command_input = (command: string, guard_writes: boolean): CommandInput => ({
  command,
  background: false,
  mode: "full",
  app_roots: roots,
  guard_writes,
  project_root: project,
  cwd: project,
  plan: false,
  chat_id: "floor-writes",
  chat_started_at: 0,
  call_id: "c1_0",
  profile: "main",
  custom_instructions: "",
  decisions: [],
  last_human_id: null,
  changed: [],
  shell: "powershell",
});

test("decide_command blocks a headless write in full mode and runs it on the desktop", async () => {
  const command = String.raw`Set-Content "$env:APPDATA\VantheaX\v2\settings.json" '{}'`;
  const guarded = await decide_command(command_input(command, true), review_stub(), new AbortController().signal);
  assert.equal(guarded.action, "block");
  assert.equal(guarded.reason, app_write_reason);
  assert.equal(guarded.record?.source, "floor");
  const desktop = await decide_command(command_input(command, false), review_stub(), new AbortController().signal);
  assert.equal(desktop.action, "run");
});

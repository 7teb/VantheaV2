import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";
import { is_msys_root_target, msys_translate } from "../electron/permissions/msys-paths.ts";

const appdata = process.env.APPDATA ?? String.raw`C:\Users\user\AppData\Roaming`;

const app_root = path.win32.join(appdata, "VantheaX");

const workspace = path.win32.join(app_root, "v2", "workspaces", "chat1");

const to_msys = (win: string) => `/${win[0]?.toLowerCase()}${win.slice(2).replace(/\\/g, "/")}`;

const scope: FloorScope = { app_root, project_root: String.raw`C:\Users\user\project`, cwd: String.raw`C:\Users\user\project` };

const in_workspace: FloorScope = { app_root, project_root: workspace, cwd: workspace };

const delete_prefixes = ["rm -rf", "rm -r --force", "rmdir", "unlink", "shred -u"];

const system_targets = ["/c/Windows", "/c/Windows/System32", "C:/Windows", "/cygdrive/c/Windows", "/c/", "C:/", "/", "/*", '"/c/Program Files"'];

const env_targets = [
  ...(process.env.SYSTEMROOT ? ["$SYSTEMROOT", "${SYSTEMROOT}"] : []),
  ...(process.env.WINDIR ? ["$WINDIR"] : []),
  ...(process.env.PROGRAMFILES ? ['"$PROGRAMFILES"'] : []),
];

const app_targets = ['"$APPDATA/VantheaX"', '"${APPDATA}/VantheaX"', '"$APPDATA/VantheaX/v2/chats"', `"${to_msys(app_root)}"`];

test("a POSIX delete verb against a protected Windows path is blocked", () => {
  for (const verb of delete_prefixes) {
    for (const target of [...system_targets, ...env_targets]) {
      assert.notEqual(floor_reason(`${verb} ${target}`, scope, "posix"), "", `${verb} ${target}`);
    }
  }
});

test("removing or moving VantheaX's own data in POSIX spellings is blocked", () => {
  for (const verb of ["rm -rf", "rmdir", "unlink"]) {
    for (const target of app_targets) {
      assert.notEqual(floor_reason(`${verb} ${target}`, scope, "posix"), "", `${verb} ${target}`);
    }
  }
  for (const target of app_targets) {
    assert.notEqual(floor_reason(`mv ${target} /d/backup`, scope, "posix"), "", `mv ${target}`);
  }
});

test("protected targets reached through variables, cd, substitutions and pipelines are blocked", () => {
  const indirect: string[] = [
    'TARGET="$APPDATA/VantheaX"; rm -rf "$TARGET"',
    'export ROOT=/c/Windows; rm -rf "$ROOT"',
    'cd "$APPDATA"; rm -rf VantheaX',
    "$(rm -rf /c/Windows)",
    "true && rm -rf /c/Windows",
    "rm -rf /c/Windows &",
    "ls; rm -rf /c/Windows",
    'find "$APPDATA/VantheaX" -type f -print0 | xargs -0 rm',
    'ls "$APPDATA/VantheaX" | xargs rm',
    "find /c/Windows -name '*.dll' -delete",
    "find /c/Windows -exec rm {} +",
  ];
  for (const command of indirect) {
    assert.notEqual(floor_reason(command, scope, "posix"), "", command);
  }
});

test("disk, partition, format and shadow-copy programs are blocked in POSIX", () => {
  const programs = [
    "diskpart /s script.txt",
    "bcdedit /delete {current}",
    "format //q //fs:ntfs c:",
    "vssadmin delete shadows /all /quiet",
    "wmic shadowcopy delete",
    "cipher //w:c",
    "dd if=/dev/zero of=/dev/sda bs=1M",
    "dd of=//./PhysicalDrive0 if=/dev/zero",
    "mkfs.ext4 /dev/sdb1",
    "parted /dev/sda rm 1",
  ];
  for (const command of programs) {
    assert.notEqual(floor_reason(command, scope, "posix"), "", command);
  }
});

test("ordinary POSIX project work and reads of the app data are not blocked", () => {
  const allowed: [string, FloorScope][] = [
    ["rm -rf node_modules", scope],
    ["rm -rf dist", scope],
    ["rm -rf ./build/out", scope],
    ["rm -f ./tmp/cache.json", scope],
    ['cat "$APPDATA/VantheaX/v2/settings.json"', scope],
    ['cp "$APPDATA/VantheaX/v2/media/a.png" ./b.png', scope],
    ['grep -r needle "$APPDATA/VantheaX/v2"', scope],
    ["git status", scope],
    ["npm ci", scope],
    ["ls /c/Windows", scope],
    ["find . -name '*.tmp' -delete", scope],
    ["echo rm -rf /c/Windows", scope],
    ["dd if=/dev/zero of=./disk.img bs=1M count=1", scope],
    ["rm -rf build", in_workspace],
    ["rm -rf ./logs", in_workspace],
  ];
  for (const [command, where] of allowed) {
    assert.equal(floor_reason(command, where, "posix"), "", command);
  }
});

test("deleting the chat workspace root itself is still blocked", () => {
  assert.notEqual(floor_reason("rm -rf .", in_workspace, "posix"), "", "rm -rf .");
});

test("a PowerShell command that shells out to bash is evaluated with the POSIX floor", () => {
  const gap = [
    "bash -c 'rm -rf /c/Windows'",
    "bash -lc 'rm -rf /c/Windows'",
    'sh -c \'rm -rf "$APPDATA/VantheaX"\'',
    "sh -c 'rm -rf /c/Windows/System32'",
  ];
  for (const command of gap) {
    assert.notEqual(floor_reason(command, scope), "", command);
  }
  assert.equal(floor_reason("bash -c 'npm run build'", scope), "", "benign bash payload");
});

test("a bash command that shells back out to PowerShell or cmd is evaluated too", () => {
  assert.notEqual(floor_reason('powershell -c "rm -rf C:\\Windows"', scope, "posix"), "", "nested powershell");
  assert.notEqual(floor_reason('bash -c \'powershell -Command "rm -rf C:\\Windows"\'', scope, "posix"), "", "bash to powershell");
  assert.notEqual(floor_reason('cmd //c "rd /s /q C:\\Windows"', scope, "posix"), "", "nested cmd");
});

test("MSYS path translation maps drives, cygdrive, ~ and the MSYS root", () => {
  assert.deepEqual(msys_translate("/c/Windows", null), { kind: "windows", path: String.raw`C:\Windows` });
  assert.deepEqual(msys_translate("/cygdrive/d/data", null), { kind: "windows", path: String.raw`D:\data` });
  assert.deepEqual(msys_translate("~/notes", String.raw`C:\Users\me`), { kind: "windows", path: String.raw`C:\Users\me\notes` });
  assert.equal(msys_translate("/usr/bin", null).kind, "msys_root");
  assert.equal(msys_translate("build/out", null).kind, "relative");
  assert.ok(is_msys_root_target("/") && is_msys_root_target("/*"));
  assert.ok(!is_msys_root_target("/usr/bin"));
});

test("the default dialect stays PowerShell for existing callers", () => {
  assert.notEqual(floor_reason("Remove-Item C:\\Windows -Recurse", scope), "");
  assert.equal(floor_reason("Remove-Item .\\dist -Recurse", scope), "");
});

test("a shell payload hidden behind a prefix or wrapper is still evaluated", () => {
  const hidden = [
    "env bash -c 'rm -rf /c/Windows'",
    "FOO=1 bash -c 'rm -rf /c/Windows'",
    "timeout 5 sh -c 'rm -rf /c/Windows'",
    "if bash -c 'rm -rf /c/Windows'; then :; fi",
  ];
  for (const command of hidden) {
    assert.notEqual(floor_reason(command, scope, "posix"), "", command);
  }
});

test("a -c payload keeps only its script word and undoes quoting", () => {
  assert.notEqual(floor_reason("bash -c 'rm -rf /c/Windows' _", scope, "posix"), "", "trailing $0 arg");
  assert.notEqual(floor_reason('bash -c "rm -rf \\"/c/Windows\\""', scope, "posix"), "", "escaped quotes");
});

test("a literal piped or here-stringed into a shell is a payload", () => {
  assert.notEqual(floor_reason("bash <<< 'rm -rf /c/Windows'", scope, "posix"), "", "here-string");
  assert.notEqual(floor_reason("echo 'rm -rf /c/Windows' | bash", scope, "posix"), "", "piped echo, posix");
  assert.notEqual(floor_reason("'rm -rf /c/Windows' | bash", scope), "", "piped literal, powershell");
  assert.notEqual(floor_reason("echo 'rm -rf /c/Windows' | bash", scope), "", "piped echo, powershell");
});

test("nested statements see the location and variables at their position", () => {
  assert.notEqual(floor_reason('cd "$APPDATA"; echo "$(rm -rf VantheaX)"; cd /d/proj', scope, "posix"), "", "cd then substitution");
  assert.notEqual(floor_reason('X=/c/Windows; echo "$(rm -rf $X)"; X=/d/tmp', scope, "posix"), "", "variable then substitution");
});

test("a POSIX reg delete against HKLM is blocked", () => {
  assert.notEqual(floor_reason("reg delete 'HKLM\\Software\\X' //f", scope, "posix"), "");
  assert.notEqual(floor_reason("reg.exe delete HKEY_LOCAL_MACHINE\\Software //f", scope, "posix"), "");
});

test("MSYS root paths other than the per-user mounts are system", () => {
  for (const root of ["/usr", "/mingw64", "/bin", "/etc"]) {
    assert.notEqual(floor_reason(`rm -rf ${root}`, scope, "posix"), "", root);
  }
  assert.notEqual(floor_reason("cd /; rm -rf *", scope, "posix"), "", "cd / then relative");
  assert.equal(floor_reason("rm -rf /tmp/scratch", scope, "posix"), "", "/tmp is allowed");
});

test("an ANSI-C quoted target resolves to its literal path", () => {
  assert.notEqual(floor_reason("rm -rf $'/c/Windows'", scope, "posix"), "");
});

test("powershell invoked with a positional command is evaluated", () => {
  const launch_scope: FloorScope = { ...scope, project_root: String.raw`D:\VantheaX`, cwd: String.raw`D:\VantheaX` };
  assert.notEqual(floor_reason("powershell Remove-Item C:\\Windows -Recurse", launch_scope, "posix"), "");
  assert.notEqual(floor_reason("powershell -NoProfile Remove-Item C:\\Windows -Recurse", launch_scope, "posix"), "");
});

test("cross-shell drive-relative Windows targets use their effective Windows location", () => {
  const launch_scope: FloorScope = { ...scope, project_root: String.raw`D:\VantheaX`, cwd: String.raw`D:\VantheaX` };
  assert.notEqual(floor_reason(String.raw`powershell.exe Remove-Item C:\Windows -Recurse`, launch_scope, "posix"), "");
  assert.equal(floor_reason(String.raw`powershell.exe Remove-Item C:\Windows -Recurse`, scope, "posix"), "");
  assert.notEqual(floor_reason("Remove-Item C:Windows -Recurse", launch_scope), "");
  assert.equal(floor_reason("Remove-Item C:Windows -Recurse", scope), "");
});

test("xargs -I and find leading options still reach the root", () => {
  assert.notEqual(floor_reason('ls "$APPDATA/VantheaX" | xargs -I {} rm -rf {}', scope, "posix"), "", "xargs -I");
  assert.notEqual(floor_reason("find -L /c/Windows -delete", scope, "posix"), "", "find -L before root");
});

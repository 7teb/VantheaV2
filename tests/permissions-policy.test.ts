import assert from "node:assert/strict";
import { test } from "node:test";
import { read_only_command } from "../electron/permissions/allowlist.ts";
import { floor_reason, type FloorScope } from "../electron/permissions/floor.ts";
import { split_statements, statement_parts } from "../electron/permissions/statements.ts";

const floor_scope: FloorScope = { app_root: "C:\\Users\\user\\AppData\\Roaming\\VantheaX", project_root: "C:\\Users\\user\\project", cwd: "C:\\Users\\user\\project" };

test("statements split on separators but not inside quotes", () => {
  assert.deepEqual(split_statements("a; b"), ["a", "b"]);
  assert.deepEqual(split_statements("a\nb\r\nc"), ["a", "b", "c"]);
  assert.deepEqual(split_statements("a | b && c || d"), ["a", "b", "c", "d"]);
  assert.deepEqual(split_statements('Write-Output "x; y"'), ['Write-Output "x; y"']);
  assert.deepEqual(split_statements("Write-Output 'a | b'"), ["Write-Output 'a | b'"]);
  assert.deepEqual(split_statements("a `\n  -Flag"), ["a    -Flag"]);
  assert.deepEqual(split_statements("a # b; c"), ["a"]);
});

test("statements include subexpressions, script blocks and string subexpressions", () => {
  assert.deepEqual(split_statements("Get-Item $(Get-Date; whoami)"), ["Get-Item $(Get-Date; whoami)", "Get-Date", "whoami"]);
  assert.deepEqual(split_statements("ls | ForEach-Object { Get-Item $_ }"), ["ls", "ForEach-Object { Get-Item $_ }", "Get-Item $_"]);
  assert.deepEqual(split_statements('Write-Output "now $(Get-Date)"'), ['Write-Output "now $(Get-Date)"', "Get-Date"]);
});

test("statements keep here-strings whole, apostrophes and separators included", () => {
  assert.deepEqual(split_statements("$s = @'\nit's; a | b # c\n'@\nWrite-Output $s"), ["$s = @'\nit's; a | b # c\n'@", "Write-Output $s"]);
  assert.deepEqual(split_statements('$s = @"\n"q" $(Get-Date)\n"@; x'), ['$s = @"\n"q" $(Get-Date)\n"@', "x", "Get-Date"]);
  assert.deepEqual(split_statements("ssh user@'host' ; b"), ["ssh user@'host'", "b"]);
});

test("statement parts keep source order, pipeline elements, offsets and lines", () => {
  const text = "a | b\n$x = @'\nc; d\n'@\ne && f";
  const parts = statement_parts(text);
  assert.deepEqual(parts.map((part) => [part.text, part.line, part.joiner]), [["a | b", 1, ""], ["$x = @'\nc; d\n'@", 2, ""], ["e", 5, ""], ["f", 5, "&&"]]);
  assert.deepEqual(parts[0]?.elements, [{ text: "a", start: 0 }, { text: "b", start: 4 }]);
  assert.equal(text.slice(parts[1]?.start), parts[1]?.text + "\ne && f");
  assert.deepEqual(statement_parts("a # x; y\nb").map((part) => part.text), ["a # x; y", "b"]);
});

test("cmd statement parts split on & outside quotes and blocks and drop rem lines", () => {
  const parts = statement_parts('set A=1 & echo "x & y" & if exist a (call b.bat & c) || d\nrem e & f\n::g & h\ncall %A%', "cmd");
  assert.deepEqual(parts.map((part) => [part.text, part.joiner]), [["set A=1", ""], ['echo "x & y"', ""], ["if exist a (call b.bat & c)", ""], ["d", "||"], ["rem e & f", ""], ["::g & h", ""], ["call %A%", ""]]);
  assert.deepEqual(statement_parts("echo a ^& b | find x", "cmd")[0]?.elements.map((element) => element.text), ["echo a ^& b", "find x"]);
});

test("floor still blocks a system path delete inside an Invoke-Expression here-string", () => {
  const windows_dir = ["C:", "Windows"].join("\\");
  assert.notEqual(floor_reason(`$c = @'\nit's fine\nRemove-Item ${windows_dir} -Recurse\n'@\nInvoke-Expression $c`, floor_scope), "");
  assert.notEqual(floor_reason(`Invoke-Expression @"\nRemove-Item ${windows_dir} -Recurse\n"@`, floor_scope), "");
});

test("floor catches statements hidden behind newlines, subexpressions, variables and .NET calls", () => {
  const windows_dir = ["C:", "Windows"].join("\\");
  const cases = [
    `Get-Content x.txt\nRemove-Item ${windows_dir} -Recurse`,
    `Get-ChildItem $(Remove-Item ${windows_dir} -Recurse)`,
    `Write-Output "$(Remove-Item ${windows_dir} -Recurse)"`,
    "$p = 'C:\\Win' + 'dows'; Remove-Item $p -Recurse",
    `[IO.Directory]::Delete('${windows_dir}', $true)`,
    `ri ${windows_dir} -Recurse`,
    "vssadmin delete shadows /all",
  ];
  for (const command of cases) {
    assert.notEqual(floor_reason(command, floor_scope), "", command);
  }
});

test("floor looks inside nested cmd and powershell payloads", () => {
  const windows_dir = ["C:", "Windows"].join("\\");
  const inner = `Remove-Item ${windows_dir} -Recurse`;
  const encoded = Buffer.from(inner, "utf16le").toString("base64");
  const cases = [
    `cmd /c "rd /s /q ${windows_dir}"`,
    `cmd.exe /c echo hi & rd /s /q ${windows_dir}`,
    `powershell -NoProfile -Command "${inner}"`,
    `pwsh.exe -c '${inner}'`,
    `powershell -NoProfile -EncodedCommand ${encoded}`,
  ];
  for (const command of cases) {
    assert.notEqual(floor_reason(command, floor_scope), "", command);
  }
  assert.equal(floor_reason('powershell -NoProfile -ExecutionPolicy Bypass -File .\\build.ps1', floor_scope), "");
  assert.equal(floor_reason('cmd /c "npm run build"', floor_scope), "");
});

test("a hash inside a token or a block comment does not hide later statements", () => {
  const windows_dir = ["C:", "Windows"].join("\\");
  assert.deepEqual(split_statements("Get-Content a#b; whoami"), ["Get-Content a#b", "whoami"]);
  assert.deepEqual(split_statements("Get-Content a <#x#>; whoami"), ["Get-Content a", "whoami"]);
  assert.deepEqual(split_statements("Get-Content a # note; whoami"), ["Get-Content a"]);
  assert.notEqual(floor_reason(`Get-Content a#b; Remove-Item -Recurse -Force ${windows_dir}`, floor_scope), "");
  assert.notEqual(floor_reason(`Get-Content a <#x#>; Remove-Item -Recurse -Force ${windows_dir}`, floor_scope), "");
  assert.equal(read_only_command("Get-Content a#b; Start-Process calc"), false);
});

test("floor follows a delete through a pipeline", () => {
  const system_dir = ["C:", "Windows", "System32"].join("\\");
  assert.notEqual(floor_reason(`Get-ChildItem ${system_dir} | Remove-Item -Recurse -Force`, floor_scope), "");
  assert.equal(floor_reason("Get-ChildItem .\\dist | Remove-Item -Recurse -Force", floor_scope), "");
  assert.equal(floor_reason(`Get-ChildItem ${system_dir} | Select-String foo`, floor_scope), "");
});

test("auto allowlist rejects reads that run programs or move branches", () => {
  for (const command of ["rg --pre calc.exe foo", "rg --pre=x foo", "git branch -D main", "git branch feature", "git branch -m a b", "git diff --ext-diff"]) {
    assert.equal(read_only_command(command), false, command);
  }
  for (const command of ["git branch", "git branch -a", "git branch --show-current", "rg -n foo"]) {
    assert.equal(read_only_command(command), true, command);
  }
});

test("floor judges each statement on its own", () => {
  assert.equal(floor_reason('& "C:\\Program Files\\nodejs\\node.exe" build.js; Remove-Item .\\dist -Recurse', floor_scope), "");
  assert.equal(floor_reason("Get-ChildItem 'C:\\Program Files'\nRemove-Item .\\tmp\\cache -Recurse", floor_scope), "");
});

test("auto allowlist accepts pure reads only", () => {
  for (const command of ["git status", "Get-Content a.txt | Select-String foo", "rg -n foo src", "Get-ChildItem -Recurse src | Measure-Object"]) {
    assert.equal(read_only_command(command), true, command);
  }
  for (const command of [
    "Get-Content a.txt\nStart-Process calc",
    "Get-Content (Set-Content f.txt y)",
    "git diff --output=patch.txt",
    "Get-ChildItem > out.txt",
    "npm install",
    "Get-ChildItem | ForEach-Object { Remove-Item $_ }",
    "",
  ]) {
    assert.equal(read_only_command(command), false, command);
  }
});


test("auto allowlist covers process, service and remote listings and silenced errors", () => {
  for (const command of [
    "Get-Process node",
    "gps | Sort-Object CPU",
    "Get-Service WinDefend",
    "git remote -v",
    "git stash list",
    "git tag --list v1*",
    "git status 2>&1",
    "Get-ChildItem missing 2>$null",
    "Get-Content x.json | ConvertFrom-Json | Group-Object kind",
    "Get-NetTCPConnection -LocalPort 5173",
  ]) {
    assert.equal(read_only_command(command), true, command);
  }
  for (const command of [
    "git remote add x https://example.invalid/x.git",
    "git stash",
    "git stash pop",
    "git tag v2",
    "Get-Process node | Stop-Process",
    "Get-Service x | Restart-Service",
    "Get-Content x 2>err.txt",
  ]) {
    assert.equal(read_only_command(command), false, command);
  }
});

test("floor reads system paths written with forward slashes the same as with backslashes", () => {
  const forward = [
    "Remove-Item -Recurse -Force C:/Windows/System32",
    "Remove-Item -Recurse -Force C:/Windows",
    'Remove-Item -Recurse -Force "C:/Program Files/x"',
    "Remove-Item -Recurse -Force 'C:/Windows/System32'",
    "[IO.Directory]::Delete('C:/Windows/System32', $true)",
    "$p = 'C:/Windows/System32'; Remove-Item $p -Recurse -Force",
    "Get-ChildItem C:/Windows/System32 | Remove-Item -Recurse -Force",
  ];
  for (const command of forward) {
    const backslash = floor_reason(command.replaceAll("/", "\\"), floor_scope);
    assert.notEqual(backslash, "", command);
    assert.equal(floor_reason(command, floor_scope), backslash, command);
  }
});

test("floor reads the env forms of the system folders and the system drive root", () => {
  const system_dir = ["C:", "Windows", "System32"].join("\\");
  const expected = floor_reason(`Remove-Item -Recurse -Force ${system_dir}`, floor_scope);
  for (const target of ["${env:SystemRoot}", "$env:SystemRoot", "${env:windir}", "$env:ProgramFiles", "${env:ProgramFiles}", "${env:ProgramFiles(x86)}", "$env:ProgramW6432", "$env:SystemDrive\\", "${env:SystemDrive}\\", "$env:SystemDrive", '"$env:SystemDrive\\*"']) {
    assert.equal(floor_reason(`Remove-Item -Recurse -Force ${target}`, floor_scope), expected, target);
  }
  assert.equal(floor_reason("Remove-Item -Recurse -Force $env:SystemDrive\\Users\\me\\proj", floor_scope), "");
  assert.equal(floor_reason("Remove-Item -Recurse -Force ${env:SystemDrive}/Users/me/proj", floor_scope), "");
});

test("floor looks inside a quoted Invoke-Expression payload", () => {
  const targets = [["C:", "Windows", "System32"].join("\\"), ["$env:APPDATA", "VantheaX"].join("\\")];
  for (const target of targets) {
    const inner = `Remove-Item ${target} -Recurse -Force`;
    const direct = floor_reason(inner, floor_scope);
    assert.notEqual(direct, "", inner);
    for (const command of [`Invoke-Expression '${inner}'`, `Invoke-Expression "${inner}"`, `iex '${inner}'`, `iex "${inner}"`, `Invoke-Expression -Command '${inner}'`]) {
      assert.equal(floor_reason(command, floor_scope), direct, command);
    }
  }
  assert.equal(floor_reason("Invoke-Expression 'npm run build'", floor_scope), "");
  assert.equal(read_only_command("iex 'Get-Content x'"), false);
  assert.equal(read_only_command("Invoke-Expression 'Get-Content x'"), false);
});

test("auto allowlist treats shell names inside file names as plain reads", () => {
  for (const command of ["cat run.cmd", "Get-Content build.cmd", "Get-ChildItem -Filter *.cmd", "Get-Content scripts/pwsh/setup.ps1", "cat iex.txt", "Get-Content irm.log"]) {
    assert.equal(read_only_command(command), true, command);
  }
  for (const command of ["Get-Content x | cmd /c type x", "Sort-Object { cmd /c x }", "Get-Content (pwsh -c x)", "Get-Content $(iex 'x')", "Get-Content x | cmd.exe /c type x", "Get-Content (powershell -c x)"]) {
    assert.equal(read_only_command(command), false, command);
  }
});

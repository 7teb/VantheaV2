import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, chat_started_at = Number.POSITIVE_INFINITY, env: Record<string, string> = {}) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-values", chat_started_at, env: { ...setup.env, ...env } });

const payloads = (sources: Awaited<ReturnType<typeof inspect>>) => sources.files.filter((file) => file.role === "payload").map((file) => file.text);

test("a literal assignment resolves the call target to a missing executable fact", async () => {
  const setup = await fixture_env();
  const target = path.join(setup.temp, "probe.exe");
  const sources = await inspect(setup, `$exe = '${target}'; & $exe`);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [["$exe", "", target, "missing"]]);
  assert.equal(sources.programs[0]?.outside, true);
});

test("environment references, Join-Path and interpolation resolve to one candidate", async () => {
  const setup = await fixture_env();
  await fs.writeFile(path.join(setup.temp, "probe.exe"), native_bytes(4096));
  const env = await inspect(setup, '& "$env:TEMP\\probe.exe"');
  assert.deepEqual(env.gaps, []);
  assert.deepEqual(env.programs.map((fact) => [fact.path, fact.kind, fact.bytes, fact.outside]), [[path.join(setup.temp, "probe.exe"), "native", 4096, true]]);
  const joined = await inspect(setup, "$dir = Join-Path $env:TEMP 'probe'; & \"$dir\\probe.exe\"");
  assert.deepEqual(joined.gaps, []);
  assert.deepEqual(fact_rows(joined).at(-1), ['"$dir\\probe.exe"', "", path.join(setup.temp, "probe", "probe.exe"), "missing"]);
  const computed = await inspect(setup, "& (Join-Path $env:TEMP 'probe.exe')");
  assert.deepEqual(computed.programs.map((fact) => [fact.path, fact.kind]), [[path.join(setup.temp, "probe.exe"), "native"]]);
});

test("an interpreter script argument from a variable is started and sent", async () => {
  const setup = await fixture_env({ "scan.py": "print('scan-marker')" });
  const sources = await inspect(setup, "$script = 'scan.py'; python $script");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["scan.py", "started"]]);
  assert.match(sent_text(sources), /scan-marker/);
});

test("resolved cmd, -Command and Invoke-Expression payloads are sent as payloads and walked", async () => {
  const setup = await fixture_env({ "child.cmd": "echo child-marker" });
  const cmd = await inspect(setup, "$command = 'call child.cmd'; cmd /c $command");
  assert.deepEqual(cmd.gaps, []);
  assert.deepEqual(payloads(cmd), ["call child.cmd"]);
  assert.match(sent_text(cmd), /child-marker/);
  const echo = await inspect(setup, "$command = 'echo hi'; cmd /c $command");
  assert.deepEqual(echo.gaps, []);
  assert.deepEqual(payloads(echo), ["echo hi"]);
  const pwsh = await inspect(setup, "$code = 'Write-Output hi'; pwsh -Command $code");
  assert.deepEqual(pwsh.gaps, []);
  assert.deepEqual(payloads(pwsh), ["Write-Output hi"]);
  const missing = await inspect(setup, "pwsh -Command $undefined");
  assert.deepEqual(missing.gaps, ["Payload could not be resolved: $undefined (no assignment in this command)"]);
  const iex = await inspect(setup, "$code = 'Write-Output hi'; Invoke-Expression $code");
  assert.deepEqual(iex.gaps, []);
  assert.deepEqual(payloads(iex), ["Write-Output hi"]);
  const literal = await inspect(setup, "cmd /c call child.cmd");
  assert.deepEqual(payloads(literal), []);
  const download = await inspect(setup, "iex (irm https://example.invalid/install.ps1)");
  assert.match(download.gaps.join("\n"), /built or downloaded at runtime/);
  const mixed = await inspect(setup, "$a = 'Write-Output a'; $a | iex; Get-Something | iex");
  assert.match(mixed.gaps.join("\n"), /built or downloaded at runtime.*Get-Something/);
});

test("Invoke-Expression text that itself runs unresolved code keeps the runtime gap", async () => {
  const setup = await fixture_env();
  const sources = await inspect(setup, "$c = 'ie' + 'x $d'; iex $c");
  assert.deepEqual(payloads(sources), ["iex $d"]);
  assert.match(sources.gaps.join("\n"), /built or downloaded at runtime gets executed and could not be inspected: iex \$d/);
});

test("Import-Module of a resolved script is started and its variables reach later launches", async () => {
  const setup = await fixture_env();
  const target = path.join(setup.temp, "from-module.exe");
  await fs.mkdir(path.join(setup.root, "tools"));
  await fs.writeFile(path.join(setup.root, "tools", "mod.psm1"), `$tool = '${target}'`);
  const sources = await inspect(setup, "$module = '.\\tools\\mod.psm1'; Import-Module $module; & $tool");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["tools/mod.psm1", "started"]]);
  assert.deepEqual(fact_rows(sources), [["$tool", "", target, "missing"]]);
  const named = await inspect(setup, "Import-Module SomeInstalledModule; & $tool");
  assert.deepEqual(named.gaps, ["Launch target could not be resolved: $tool (changed by a script the app did not read)"]);
});

test("Start-Process, saps and Process.Start keep their launch target", async () => {
  const setup = await fixture_env();
  const target = path.join(setup.temp, "probe.exe");
  const start = await inspect(setup, `$exe = '${target}'; Start-Process -FilePath $exe`);
  assert.deepEqual(start.gaps, []);
  assert.deepEqual(fact_rows(start), [["$exe", "Start-Process", target, "missing"]]);
  const saps = await inspect(setup, `$exe = '${target}'; saps $exe`);
  assert.deepEqual(fact_rows(saps), [["$exe", "Start-Process", target, "missing"]]);
  const dotnet = await inspect(setup, `$exe = '${target}'; [System.Diagnostics.Process]::Start($exe)`);
  assert.deepEqual(dotnet.gaps, []);
  assert.deepEqual(fact_rows(dotnet), [["[System.Diagnostics.Process]::Start($exe)", "Process.Start", target, "missing"]]);
  const unknown = await inspect(setup, "Start-Process $undefined");
  assert.deepEqual(unknown.gaps, ["Launch target could not be resolved: $undefined (no assignment in this command)"]);
  const info = await inspect(setup, "$psi = New-Object System.Diagnostics.ProcessStartInfo; [System.Diagnostics.Process]::Start($psi)");
  assert.deepEqual(info.gaps, ["Launch target could not be resolved: [System.Diagnostics.Process]::Start($psi) (assigned from command output)"]);
});

test("a call target or payload that is not written literally is shown with its value", async () => {
  const setup = await fixture_env();
  const op = await inspect(setup, "$op='Remove' + '-Item'; & $op 'x'");
  assert.deepEqual(op.gaps, []);
  assert.deepEqual(fact_rows(op), [["$op", "", "Remove-Item", "builtin"]]);
  const plain = await inspect(setup, "Remove-Item 'x'");
  assert.deepEqual(plain.programs, []);
  const env = await inspect(setup, "cmd /c $env:VX_PAYLOAD", Number.POSITIVE_INFINITY, { VX_PAYLOAD: "echo payload-marker" });
  assert.deepEqual(env.gaps, []);
  assert.deepEqual(payloads(env), ["echo payload-marker"]);
  const unset = await inspect(setup, "cmd /c $env:VX_PAYLOAD");
  assert.deepEqual(unset.gaps, ["Payload could not be resolved: $env:VX_PAYLOAD (not set in the environment)"]);
});

test("owner ml64 shape: the assembler is a program fact and the assembly source is not read", async () => {
  const setup = await fixture_env({ "src/x64_stub.asm": "END" });
  const ml = path.join(setup.temp, "vc", "bin", "Hostx64", "x64", "ml64.exe");
  await fs.mkdir(path.dirname(ml), { recursive: true });
  await fs.writeFile(ml, native_bytes(751976));
  const command = `$ml = '${ml}'; & $ml /c /nologo /Fo"$env:TEMP\\stub.obj" "${setup.root}\\src\\x64_stub.asm"; "ml64 exit=$LASTEXITCODE"; Get-ChildItem "$env:TEMP\\stub.obj" | Select-Object Name,Length`;
  const sources = await inspect(setup, command);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files, []);
  assert.deepEqual(sources.programs.map((fact) => [fact.written, fact.path, fact.kind, fact.bytes]), [["$ml", ml, "native", 751976]]);
});

test("owner msbuild shape: executables over the read limit built in this chat are program facts, never a gap", async () => {
  const setup = await fixture_env({ "GuardPage.sln": "Microsoft Visual Studio Solution File" });
  const release = path.join(setup.root, "build-native", "bin", "Win32", "Release");
  await fs.mkdir(release, { recursive: true });
  for (const name of ["example.exe", "tests.exe"]) await fs.writeFile(path.join(release, name), native_bytes(1350000));
  const msbuild = path.join(setup.temp, "MSBuild", "Current", "Bin", "MSBuild.exe");
  await fs.mkdir(path.dirname(msbuild), { recursive: true });
  await fs.writeFile(msbuild, native_bytes(387856));
  const command = [
    `$msbuild = '${msbuild}'`,
    `& $msbuild GuardPage.sln /m /p:Configuration=Release /p:Platform=Win32 "/t:probe_tests;probe_example" 2>&1 | Select-Object -Last 10`,
    `& '${path.join(release, "example.exe")}'`,
    `& '${path.join(release, "tests.exe")}'`,
  ].join("\n");
  const sources = await inspect(setup, command, 0);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.filter((file) => file.role === "started"), []);
  const exes = sources.programs.filter((fact) => fact.path.startsWith(release));
  assert.deepEqual(exes.map((fact) => [path.basename(fact.path), fact.kind, fact.bytes, fact.change?.kind]), [["example.exe", "native", 1350000, "created"], ["tests.exe", "native", 1350000, "created"]]);
  assert.ok(sources.pins.some((pin) => pin.path === exes[0]?.path && pin.sha256));
  assert.equal(sources.programs.find((fact) => fact.written === "$msbuild")?.outside, true);
});

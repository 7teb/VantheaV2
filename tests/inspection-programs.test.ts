import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { changed_pins } from "../electron/permissions/source-read.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, chat_started_at = Number.POSITIVE_INFINITY) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-programs", chat_started_at, env: setup.env });

const roles = (sources: Awaited<ReturnType<typeof inspect>>) => sources.files.map((file) => [file.path, file.role]);

const tool = async (setup: FixtureEnv, relative: string, bytes: number): Promise<string> => {
  const file = path.join(setup.temp, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, native_bytes(bytes));
  return file;
};

test("a bare executable name off PATH is a fact and a cmdlet gives no line", async () => {
  const setup = await fixture_env();
  const probe = await inspect(setup, "probe.exe");
  assert.deepEqual(probe.gaps, []);
  assert.deepEqual(fact_rows(probe), [["probe.exe", "", "probe.exe", "not_found"]]);
  const cmdlet = await inspect(setup, "Get-ChildItem -Recurse | Select-Object Name");
  assert.deepEqual(cmdlet.gaps, []);
  assert.deepEqual(cmdlet.programs, []);
});

test("a quoted response file is an input that is read and sent, an unquoted @name is splatting", async () => {
  const setup = await fixture_env({ "build.rsp": "/c main.cpp /Fe:probe.exe" });
  const sources = await inspect(setup, "cl.exe '@build.rsp'");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [["cl.exe", "", "cl.exe", "not_found"]]);
  assert.deepEqual(roles(sources), [["build.rsp", "input"]]);
  assert.match(sent_text(sources), /main\.cpp \/Fe:probe\.exe/);
  const splat = await inspect(setup, "cl.exe @build");
  assert.deepEqual(splat.files, []);
  const cmd = await inspect(setup, 'cmd /c "cl.exe @build.rsp"');
  assert.deepEqual(roles(cmd), [["build.rsp", "input"]]);
});

test("a project file argument is an input, a cmdlet argument is not", async () => {
  const setup = await fixture_env({ "probe.vcxproj": "<Project><Target Name=\"Build\" /></Project>" });
  const sources = await inspect(setup, "MSBuild.exe probe.vcxproj /t:Rebuild");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(roles(sources), [["probe.vcxproj", "input"]]);
  assert.match(sent_text(sources), /Target Name="Build"/);
  const read = await inspect(setup, "Get-Content probe.vcxproj");
  assert.deepEqual(read.files, []);
});

test("owner build script shape: msbuild fact, the solution as input with its projects loaded, the built exes missing", async () => {
  const setup = await fixture_env({
    "probe.sln": 'Project("{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}") = "probe", "probe.vcxproj", "{A}"\r\nEndProject\r\n',
    "probe.vcxproj": "<Project />",
  });
  const msbuild = await tool(setup, "MSBuild\\Current\\Bin\\MSBuild.exe", 387856);
  const command = [
    `$msbuild = '${msbuild}'`,
    `"=== Release Win32 build ==="`,
    "& $msbuild probe.sln /p:Configuration=Release /p:Platform=Win32 /m",
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "& .\\Release\\example.exe",
    "& .\\Release\\tests.exe",
  ].join("\n");
  const sources = await inspect(setup, command);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [
    ["$msbuild", "", msbuild, "native"],
    [".\\Release\\example.exe", "", path.join(setup.root, "Release", "example.exe"), "missing"],
    [".\\Release\\tests.exe", "", path.join(setup.root, "Release", "tests.exe"), "missing"],
  ]);
  assert.deepEqual(roles(sources), [["probe.sln", "input"], ["probe.vcxproj", "loaded"]]);
  const quoted = await inspect(setup, `& '${msbuild}' probe.sln /p:Configuration=Release`);
  assert.deepEqual(quoted.gaps, []);
  assert.deepEqual(fact_rows(quoted), [[`'${msbuild}'`, "", msbuild, "native"]]);
  assert.equal(quoted.programs[0]?.outside, true);
  assert.deepEqual(roles(quoted), [["probe.sln", "input"], ["probe.vcxproj", "loaded"]]);
});

test("a missing ml64 path is a fact and the assembly source is never read", async () => {
  const setup = await fixture_env({ "foo.asm": "END" });
  const ml = path.join(setup.temp, "VC", "Tools", "MSVC", "14.50.0", "bin", "Hostx64", "x64", "ml64.exe");
  const sources = await inspect(setup, `$ml = '${ml}'; & $ml /c foo.asm`);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [["$ml", "", ml, "missing"]]);
  assert.deepEqual(sources.files, []);
});

test("a literal script stays the baseline: started and sent", async () => {
  const setup = await fixture_env({ "build.ps1": "Write-Output build-marker" });
  const sources = await inspect(setup, ".\\build.ps1");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(roles(sources), [["build.ps1", "started"]]);
  assert.match(sent_text(sources), /build-marker/);
});

test("inputs: missing ones are pinned without a gap, outside ones are a note, and only a changed one over the read limit is a gap", async () => {
  const setup = await fixture_env();
  const make = await tool(setup, "bin\\make.exe", 64);
  const missing = await inspect(setup, `& '${make}' -f Makefile`);
  assert.deepEqual(missing.gaps, []);
  assert.deepEqual(missing.files, []);
  assert.ok(missing.pins.some((pin) => pin.path === path.join(setup.root, "Makefile") && pin.sha256 === null));
  await fs.writeFile(path.join(setup.root, "Makefile"), "all:\n\techo made\n");
  const appeared = await changed_pins(missing.pins);
  assert.deepEqual(appeared.map((change) => [change.path, change.before]), [[path.join(setup.root, "Makefile"), null]]);
  assert.ok(appeared[0]?.after);
  const outside = path.join(setup.temp, "probe.vcxproj");
  const away = await inspect(setup, `& '${make}' '${outside}'`);
  assert.deepEqual(away.gaps, []);
  assert.deepEqual(away.notes, [`input outside the project, not read: ${outside}`]);
  await fs.writeFile(path.join(setup.root, "huge.sln"), "x".repeat(1048577));
  const unchanged = await inspect(setup, `& '${make}' huge.sln`);
  assert.deepEqual(unchanged.gaps, []);
  assert.deepEqual(roles(unchanged), [["huge.sln", "input"]]);
  const changed = await inspect(setup, `& '${make}' huge.sln`, 0);
  assert.match(changed.gaps.join("\n"), /^Source file exceeds the read limit .*huge\.sln/);
});

test("Start-Process resolves inputs against its working directory", async () => {
  const setup = await fixture_env({ "sub/probe.sln": "Microsoft Visual Studio Solution File" });
  const msbuild = await tool(setup, "MSBuild.exe", 64);
  const sources = await inspect(setup, `Start-Process -FilePath '${msbuild}' -ArgumentList 'probe.sln /m' -WorkingDirectory '${path.join(setup.root, "sub")}'`);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(roles(sources), [["sub/probe.sln", "input"]]);
});

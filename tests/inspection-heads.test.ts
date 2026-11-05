import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fixture_env, native_bytes, type FixtureEnv } from "./sources-fixture.ts";

const setup_heads = async (): Promise<FixtureEnv> => {
  const setup = await fixture_env({
    "gen.ps1": "python absent.py",
    "a.ps1": "python absent.py",
    "b.ps1": "Write-Output b",
    "run.sh": "echo run-marker",
    "logs/big.log": "subprocess.run(cmd)\n" + "x".repeat(400000),
    "package.json": JSON.stringify({ scripts: { build: '"Release/example.exe" --x' } }),
  });
  await fs.mkdir(path.join(setup.root, "Release"));
  await fs.writeFile(path.join(setup.root, "Release", "example.exe"), native_bytes(1200000));
  await fs.writeFile(path.join(setup.root, "Release", "tests.exe"), native_bytes(300000));
  return setup;
};

const inspect = (setup: FixtureEnv, command: string) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-heads", chat_started_at: 0, env: setup.env });

const started = (sources: Awaited<ReturnType<typeof inspect>>) => sources.files.filter((file) => file.role === "started").map((file) => file.path);

const programs = (sources: Awaited<ReturnType<typeof inspect>>) => sources.programs.map((fact) => path.basename(fact.path));

test("paths in data, arrays and expressions start nothing", async () => {
  const setup = await setup_heads();
  const absolute = path.join(setup.root, "Release");
  const commands = [
    "foreach ($file in @('.\\Release\\example.exe', '.\\Release\\tests.exe')) { $bytes = [IO.File]::ReadAllBytes($file); $bytes.Length }",
    `foreach ($file in @('${absolute}\\example.exe', '${absolute}\\tests.exe')) { $bytes = [IO.File]::ReadAllBytes($file); $bytes.Length }`,
    "foreach ($file in @('.\\Release\\example.exe', '.\\Release\\tests.exe')) { (Get-Item $file).Length }",
    "$files = @('.\\Release\\example.exe'); $files | ForEach-Object { [IO.File]::ReadAllBytes($_).Length }",
    "[IO.File]::ReadAllBytes('.\\Release\\example.exe').Length",
    "Test-Path('.\\Release\\example.exe')",
    "'.\\Release\\example.exe' | Get-FileHash",
    "$list = '.\\Release\\example.exe', '.\\Release\\tests.exe'",
    "$h = @{ exe = '.\\Release\\example.exe' }",
    "'.\\gen.ps1'",
    '"$root\\gen.ps1"',
    "foreach ($f in @('.\\logs\\big.log')) { Select-String -Path $f -Pattern err }",
    "Get-FileHash '.\\Release\\example.exe'",
  ];
  for (const command of commands) {
    const sources = await inspect(setup, command);
    assert.deepEqual(started(sources), [], command);
    assert.deepEqual(sources.programs, [], command);
    assert.deepEqual(sources.gaps, [], command);
    assert.equal(sources.files.some((file) => file.path.endsWith("big.log")), false, command);
  }
});

test("an executable at a command position is a program fact without a read-limit gap", async () => {
  const setup = await setup_heads();
  const commands = [
    ".\\Release\\example.exe --version",
    "& '.\\Release\\example.exe' --version",
    "(.\\Release\\example.exe --version)",
    "@(.\\Release\\example.exe)",
    "Test-Path(.\\Release\\example.exe)",
    "Start-Process '.\\Release\\example.exe'",
    "cmd /c '\"Release\\example.exe\" --x'",
    "npm run build",
    "$x = .\\Release\\example.exe",
    "$out = & '.\\Release\\example.exe'",
    "foreach ($l in .\\Release\\example.exe) { $l }",
    "return .\\Release\\example.exe",
    "$h = @{ a = .\\Release\\example.exe }",
    "[System.Collections.Generic.List[string]]$x = .\\Release\\example.exe",
  ];
  for (const command of commands) {
    const sources = await inspect(setup, command);
    assert.deepEqual(sources.gaps, [], command);
    assert.deepEqual(started(sources), [], command);
    assert.ok(programs(sources).includes("example.exe"), command);
    assert.equal(sources.programs.find((fact) => fact.path.endsWith("example.exe"))?.change?.kind, "created", command);
  }
});

test("a quoted head runs in posix and an unresolved call target keeps its gap", async () => {
  const setup = await setup_heads();
  const posix = await inspect(setup, "bash -c '\"./run.sh\" x'");
  assert.deepEqual(started(posix), ["run.sh"]);
  assert.deepEqual(posix.gaps, []);
  const unresolved = await inspect(setup, '& "$root\\gen.ps1"');
  assert.deepEqual(unresolved.gaps, ['Launch target could not be resolved: "$root\\gen.ps1" (no assignment in this command)']);
});

test("an assignment right side is followed and a data list of scripts is only named", async () => {
  const setup = await setup_heads();
  const assigned = await inspect(setup, "$v = .\\gen.ps1");
  assert.deepEqual(started(assigned), ["gen.ps1"]);
  assert.match(assigned.gaps.join("\n"), /Source is unavailable:.*absent\.py/);
  const listed = await inspect(setup, "foreach ($f in @('.\\a.ps1', '.\\b.ps1')) { Get-Content $f }");
  assert.deepEqual(listed.gaps, []);
  assert.deepEqual(listed.files.map((file) => [file.path, file.role]), [["a.ps1", "named"], ["b.ps1", "named"]]);
});

test("owner byte scan over a literal executable list reads and starts nothing", async () => {
  const setup = await setup_heads();
  const release = path.join(setup.root, "Release");
  const command = `foreach ($f in @('${release}\\example.exe', '${release}\\tests.exe')) { $b = [IO.File]::ReadAllBytes($f); $hits = 0; for ($i = 0; $i -lt $b.Length - 1; $i++) { if ($b[$i] -eq 0x0F -and $b[$i + 1] -eq 0x05) { $hits++ } }; "$f $hits" }`;
  const sources = await inspect(setup, command);
  assert.deepEqual(sources.programs, []);
  assert.deepEqual(sources.files, []);
  assert.deepEqual(sources.gaps, []);
});

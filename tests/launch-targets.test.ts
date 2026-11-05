import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { expand_launch_pattern, launch_kind, location_matches, path_lookup } from "../electron/permissions/launch-targets.ts";
import { changed_pins } from "../electron/permissions/source-read.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, native_bytes, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, chat_started_at = Number.POSITIVE_INFINITY, env: Record<string, string> = {}) =>
  inspect_command_sources(setup.root, setup.root, command, { chat_id: "c-launch", chat_started_at, env: { ...setup.env, ...env } });

test("an MZ header makes an .exe native at any size and other files stay content", async () => {
  const setup = await fixture_env();
  const write = (name: string, body: Buffer | string) => fs.writeFile(path.join(setup.root, name), body);
  await write("small.exe", native_bytes(64));
  await write("large.exe", native_bytes(1100000));
  await write("text.exe", "not a program");
  const small = await fs.stat(path.join(setup.root, "small.exe"));
  assert.deepEqual(await launch_kind(path.join(setup.root, "small.exe")), { kind: "native", bytes: 64, mtime: small.mtimeMs, birthtime: small.birthtimeMs });
  assert.equal((await launch_kind(path.join(setup.root, "large.exe"))).kind, "native");
  assert.equal((await launch_kind(path.join(setup.root, "text.exe"))).kind, "file");
  assert.equal((await launch_kind(setup.root)).kind, "directory");
  assert.equal((await launch_kind(path.join(setup.root, "absent.exe"))).kind, "missing");
});

test("the extension decides how a launched file with an MZ header is read", async () => {
  const setup = await fixture_env();
  const write = (name: string, body: Buffer | string) => fs.writeFile(path.join(setup.root, name), body);
  await write("script.ps1", "MZ is the first line of this script\nWrite-Output ps1-marker");
  await write("fake.bat", native_bytes(64));
  await write("library.dll", native_bytes(64));
  await write("packed.exe", Buffer.from([0x50, 0x4b, 0, 0, 1, 2]));
  const script = await inspect(setup, ".\\script.ps1");
  assert.deepEqual(script.gaps, []);
  assert.match(sent_text(script), /ps1-marker/);
  const bat = await inspect(setup, ".\\fake.bat");
  assert.deepEqual(bat.gaps, [`Source file is binary: ${path.join(setup.root, "fake.bat")}`]);
  const dll = await inspect(setup, "& .\\library.dll");
  assert.deepEqual(dll.gaps, [`Launched file is binary and not an executable: ${path.join(setup.root, "library.dll")}`]);
  const packed = await inspect(setup, ".\\packed.exe");
  assert.deepEqual(packed.gaps, [`Launched file is binary and not an executable: ${path.join(setup.root, "packed.exe")}`]);
});

test("network paths are never checked and secret paths are refused", async () => {
  const setup = await fixture_env();
  const program = await inspect(setup, "& '\\\\server\\share\\tool.exe'");
  assert.deepEqual(program.gaps, []);
  assert.deepEqual(fact_rows(program), [["'\\\\server\\share\\tool.exe'", "", "\\\\server\\share\\tool.exe", "network"]]);
  const script = await inspect(setup, "& '\\\\server\\share\\setup.ps1'");
  assert.deepEqual(script.gaps, ["Source is on a network path and was not read: \\\\server\\share\\setup.ps1"]);
  await fs.mkdir(path.join(setup.root, ".ssh"));
  await fs.writeFile(path.join(setup.root, ".ssh", "agent.exe"), native_bytes(64));
  const secret = await inspect(setup, "& '.\\.ssh\\agent.exe'");
  assert.deepEqual(secret.programs, []);
  assert.match(secret.gaps.join("\n"), /outside the project or protected:.*agent\.exe/);
});

test("PATH lookups name the first folder with a match and only names with an executable extension get a line without one", async () => {
  const setup = await fixture_env();
  const later = path.join(setup.temp, "later");
  await fs.mkdir(later);
  await fs.writeFile(path.join(setup.bin, "tool.exe"), native_bytes(128));
  await fs.writeFile(path.join(later, "tool.cmd"), "echo later");
  const env = { PATH: `${setup.bin};${later}` };
  const found = await inspect(setup, "tool --version", Number.POSITIVE_INFINITY, env);
  assert.deepEqual(found.gaps, []);
  assert.deepEqual(fact_rows(found), [["tool", "PATH", path.join(setup.bin, "tool.exe"), "native"]]);
  assert.deepEqual(found.notes, []);
  const missing = await inspect(setup, "probe.exe; Get-ChildItem");
  assert.deepEqual(fact_rows(missing), [["probe.exe", "", "probe.exe", "not_found"]]);
  assert.deepEqual(missing.notes, []);
  const unresolved = await inspect(setup, "$env:Path = $folder; tool");
  assert.deepEqual(unresolved.gaps, ["Launch target could not be resolved: tool (PATH changed to an unresolved value)"]);
});

test("the PATH index is revalidated when a folder changes", async () => {
  const setup = await fixture_env();
  assert.deepEqual(await path_lookup()(["fresh.exe"], [setup.bin]), []);
  await fs.writeFile(path.join(setup.bin, "fresh.exe"), native_bytes(64));
  const later = new Date(Date.now() + 5000);
  await fs.utimes(setup.bin, later, later);
  assert.deepEqual(await path_lookup()(["fresh.exe"], [setup.bin]), [{ dir: setup.bin, file: path.join(setup.bin, "fresh.exe"), installed: false }]);
});

test("a PATH script modified in this chat is read, an unchanged one is a fact", async () => {
  const setup = await fixture_env({ "tools-bin/deploy.cmd": "echo deploy-marker" });
  const env = { PATH: path.join(setup.root, "tools-bin") };
  const changed = await inspect(setup, "deploy", 0, env);
  assert.deepEqual(changed.gaps, []);
  assert.match(sent_text(changed), /deploy-marker/);
  const unchanged = await inspect(setup, "deploy", Number.POSITIVE_INFINITY, env);
  assert.deepEqual(unchanged.files, []);
  assert.deepEqual(fact_rows(unchanged), [["deploy", "PATH", path.join(setup.root, "tools-bin", "deploy.cmd"), "script"]]);
});

test("package scripts see node_modules\\.bin first and its shims are installed-package facts", async () => {
  const setup = await fixture_env({
    "package.json": JSON.stringify({ scripts: { build: "tsc -p tsconfig.json && node build.mjs" } }),
    "node_modules/.bin/tsc.cmd": "@\"%~dp0\\..\\typescript\\bin\\tsc\" %*",
    "build.mjs": "console.log('build-marker')",
  });
  const sources = await inspect(setup, "npm run build", 0);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [["tsc", "installed package", path.join(setup.root, "node_modules", ".bin", "tsc.cmd"), "installed"]]);
  assert.equal(sources.files.some((file) => file.path.includes("tsc")), false);
  assert.match(sent_text(sources), /build-marker/);
});

test("cmd searches the location before PATH", async () => {
  const setup = await fixture_env({ "tool.bat": "echo local-marker" });
  await fs.writeFile(path.join(setup.bin, "tool.exe"), native_bytes(64));
  const sources = await inspect(setup, "cmd /c tool");
  assert.deepEqual(sources.gaps, []);
  assert.match(sent_text(sources), /local-marker/);
  assert.deepEqual(sources.programs.filter((fact) => fact.written === "tool"), []);
});

test("wildcard launches and location patterns understand character classes", async () => {
  const setup = await fixture_env({ "b1.ps1": "Write-Output b1", "b2.ps1": "Write-Output b2", "b3.ps1": "Write-Output b3", "sub/x/keep.txt": "" });
  assert.deepEqual((await expand_launch_pattern(path.join(setup.root, "b[12].ps1"))).files, [path.join(setup.root, "b1.ps1"), path.join(setup.root, "b2.ps1")]);
  assert.deepEqual((await expand_launch_pattern(path.join(setup.root, "b[!1].ps1"))).files, [path.join(setup.root, "b2.ps1"), path.join(setup.root, "b3.ps1")]);
  assert.deepEqual(location_matches(path.join(setup.root, "s*")), [path.join(setup.root, "sub")]);
  const moved = await inspect(setup, "Set-Location -Path 's*'; Set-Location x; Get-ChildItem");
  assert.deepEqual(moved.notes, []);
});

test("a missing executable inside the project is a fact pinned absent, so a later build triggers the recheck", async () => {
  const setup = await fixture_env();
  const target = path.join(setup.root, "Release", "example.exe");
  const sources = await inspect(setup, "& .\\Release\\example.exe");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(fact_rows(sources), [[".\\Release\\example.exe", "", target, "missing"]]);
  assert.deepEqual(sources.pins, [{ path: target, sha256: null }]);
  assert.deepEqual(await changed_pins(sources.pins), []);
  await fs.mkdir(path.dirname(target));
  await fs.writeFile(target, native_bytes(64));
  assert.equal((await changed_pins(sources.pins)).length, 1);
  const venv = await inspect(setup, ".venv\\Scripts\\pip install pefile");
  const pip = path.join(setup.root, ".venv", "Scripts", "pip");
  assert.deepEqual(venv.gaps, []);
  assert.deepEqual(fact_rows(venv), [[".venv\\Scripts\\pip", "", pip, "missing"]]);
  assert.ok(venv.pins.some((pin) => pin.path === pip + ".exe" && pin.sha256 === null));
  const script = await inspect(setup, "& .\\Release\\missing.ps1");
  assert.deepEqual(script.gaps, [`Source is unavailable: ${path.join(setup.root, "Release", "missing.ps1")} (ENOENT)`]);
});

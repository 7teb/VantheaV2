import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { fact_rows, fixture_env, sent_text, type FixtureEnv } from "./sources-fixture.ts";

const inspect = (setup: FixtureEnv, command: string, cwd = setup.root) =>
  inspect_command_sources(setup.root, cwd, command, { chat_id: "c-location", chat_started_at: Number.POSITIVE_INFINITY, env: setup.env });

const scripts = { "tools/a.ps1": "Write-Output a-marker", "tools/b.ps1": "Write-Output b-marker", "scan.py": "print('scan-marker')", "sub/keep.txt": "" };

test("a Start-Process working directory is a note and a relative file is looked up in both folders", async () => {
  const setup = await fixture_env({ "sub/tool.bat": "echo tool-marker" });
  const target = path.join(setup.temp, "probe.exe");
  const literal = await inspect(setup, `Start-Process -FilePath '${target}' -WorkingDirectory '${setup.root}'`);
  assert.deepEqual(literal.gaps, []);
  assert.deepEqual(fact_rows(literal), [[`'${target}'`, `Start-Process, working directory ${setup.root}`, target, "missing"]]);
  assert.ok(literal.notes.includes(`Start-Process '${target}' runs in working directory ${setup.root}`));
  const relative = await inspect(setup, "Start-Process -FilePath 'tool.bat' -WorkingDirectory 'sub'");
  assert.deepEqual(relative.gaps, []);
  assert.deepEqual(relative.files.map((file) => [file.path, file.role]), [["sub/tool.bat", "started"]]);
  assert.ok(relative.pins.some((pin) => pin.path === path.join(setup.root, "tool.bat") && pin.sha256 === null));
  const unknown = await inspect(setup, "Start-Process -FilePath 'tool.bat' -WorkingDirectory $folder");
  assert.deepEqual(unknown.gaps, ["Launch target could not be resolved: 'tool.bat' (no assignment in this command)"]);
});

test("Set-Location -LiteralPath moves the location for a relative script", async () => {
  const setup = await fixture_env(scripts);
  const sources = await inspect(setup, `Set-Location -LiteralPath '${setup.root}'; .\\tools\\a.ps1`, path.join(setup.root, "sub"));
  assert.deepEqual(sources.gaps, []);
  assert.match(sent_text(sources), /a-marker/);
});

test("Push-Location and Pop-Location restore the location and an empty stack keeps it", async () => {
  const setup = await fixture_env(scripts);
  const restored = await inspect(setup, `Push-Location '${setup.root}\\tools'; Pop-Location; .\\tools\\a.ps1`);
  assert.deepEqual(restored.gaps, []);
  assert.deepEqual(restored.files.map((file) => file.path), ["tools/a.ps1"]);
  const empty = await inspect(setup, "Pop-Location; .\\tools\\a.ps1");
  assert.deepEqual(empty.gaps, []);
  assert.deepEqual(empty.files.map((file) => file.path), ["tools/a.ps1"]);
});

test("a wildcard launch starts every match and 0 or more than 8 matches are gaps", async () => {
  const setup = await fixture_env(scripts);
  const both = await inspect(setup, "& '.\\tools\\*.ps1'");
  assert.deepEqual(both.gaps, []);
  assert.deepEqual(both.files.map((file) => [file.path, file.role]), [["tools/a.ps1", "started"], ["tools/b.ps1", "started"]]);
  const none = await inspect(setup, "& '.\\tools\\*.psm1'");
  assert.deepEqual(none.gaps, ["Launch target could not be resolved: '.\\tools\\*.psm1' (wildcard matches no file)"]);
  for (let index = 0; index < 9; index += 1) await fs.writeFile(path.join(setup.root, "tools", `many${index}.cmd`), "echo many");
  const many = await inspect(setup, "& '.\\tools\\many*.cmd'");
  assert.deepEqual(many.gaps, ["Launch target could not be resolved: '.\\tools\\many*.cmd' (wildcard matches more than 8 files)"]);
});

test("an unresolved location change is a note, and only launches that depend on it are gaps", async () => {
  const setup = await fixture_env(scripts);
  const target = path.join(setup.temp, "probe.exe");
  const sources = await inspect(setup, `cd $target; python scan.py; & '${target}'`);
  assert.deepEqual(sources.gaps, ["Launch target could not be resolved: scan.py (working directory unknown after: cd $target)"]);
  assert.deepEqual(sources.notes, ["working directory unknown after: cd $target"]);
  assert.deepEqual(fact_rows(sources), [[`'${target}'`, "", target, "missing"]]);
  const package_call = await inspect(setup, "cd $target; npm test");
  assert.deepEqual(package_call.gaps, ["Package script working directory could not be resolved."]);
});

test("a dot-sourced script returns its location and environment to the caller", async () => {
  const setup = await fixture_env({ ...scripts, "env.ps1": "Set-Location .\\tools\n$env:VX_TOOL = 'b.ps1'" });
  const sources = await inspect(setup, ". .\\env.ps1; & \".\\$env:VX_TOOL\"");
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role]), [["env.ps1", "started"], ["tools/b.ps1", "started"]]);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { detect_server } from "../electron/mcp/detect.ts";
import { import_legacy_skills } from "../electron/skills/legacy.ts";
import { commit_skill, init_skills, refresh_skills, remove_skill, set_skill_enabled, skill_entries } from "../electron/skills/store.ts";
import { get_settings, init_settings } from "../electron/settings/store.ts";

let root = "";
let sequence = 0;
const fresh = async () => { const dir = path.join(root, String(++sequence)); await fs.mkdir(dir); return dir; };
const write = async (dir: string, relative: string, text = "fixture") => { const file = path.join(dir, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); return file; };
const raw = (name: string, body = "instructions") => `---\nname: ${name}\ndescription: fixture\n---\n${body}\n`;
const prepared = (name: string, body = "instructions") => ({ name, description: "fixture", raw: raw(name, body), extras: [], source: "fixture", ref: "", commit: "", sha256: "fixture" });

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-skills-import-"));
  await init_settings({ files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "absent") }, codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher }, on_change: () => {} });
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

for (const folder of [".venv", "venv", "env", "custom-python"]) test(`project entry wins over installed Python modules in ${folder}`, async () => {
  const dir = await fresh();
  const entry = await write(dir, "main.py");
  const python = await write(dir, `${folder}/Scripts/python.exe`);
  await write(dir, `${folder}/pyvenv.cfg`, "home = C:/Python");
  await write(dir, `${folder}/Lib/site-packages/mcp/server.py`);
  const found = await detect_server(dir);
  assert.equal(found.ok, true);
  assert.deepEqual(found.config.args, [entry]);
  assert.equal(found.config.command, python);
});

test("a nested README never hides the root README", async () => {
  const dir = await fresh();
  const entry = await write(dir, "root.js");
  await write(dir, "README.md", '```json\n{"command":"node","args":["root.js"]}\n```');
  await write(dir, "aaa/README.md", '```json\n{"command":"node","args":["nested.js"]}\n```');
  await write(dir, "aaa/nested.js");
  assert.deepEqual((await detect_server(dir)).config.args, [entry]);
});

test("legacy import rejects executable content at nested depths", async () => {
  const dir = await fresh();
  const legacy = path.join(dir, "legacy");
  const target = path.join(dir, "target");
  await fs.mkdir(target);
  await write(legacy, "unsafe/SKILL.md", raw("Unsafe"));
  await write(legacy, "unsafe/docs/helpers/start.PS1", "Write-Output fixture");
  assert.deepEqual(await import_legacy_skills(legacy, target), {});
  assert.equal(await fs.readFile(path.join(legacy, "unsafe/docs/helpers/start.PS1"), "utf8"), "Write-Output fixture");
  assert.deepEqual(await fs.readdir(target), []);
});

test("recursive text-only legacy skills remain importable", async () => {
  const dir = await fresh();
  const legacy = path.join(dir, "legacy");
  const target = path.join(dir, "target");
  await fs.mkdir(target);
  await write(legacy, "safe/SKILL.md", raw("Safe"));
  await write(legacy, "safe/docs/helpers/notes.md", "keep notes");
  assert.deepEqual(Object.keys(await import_legacy_skills(legacy, target)), ["safe"]);
  assert.equal(await fs.readFile(path.join(target, "safe/docs/helpers/notes.md"), "utf8"), "keep notes");
});

test("removing and reinstalling a skill does not resurrect its old disabled state", async () => {
  const dir = await fresh();
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  await commit_skill(prepared("Reinstall"));
  await set_skill_enabled("reinstall", false);
  await remove_skill("reinstall");
  await commit_skill(prepared("Reinstall", "fresh instructions"));
  assert.equal(skill_entries().find((entry) => entry.slug === "reinstall")?.enabled, true);
});

test("an in-place update preserves an explicitly disabled skill", async () => {
  const dir = await fresh();
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  await commit_skill(prepared("Update"));
  await set_skill_enabled("update", false);
  await commit_skill(prepared("Update", "updated instructions"));
  assert.equal(skill_entries().find((entry) => entry.slug === "update")?.enabled, false);
});

test("a fresh install clears stale disabled state left by an externally removed folder", async () => {
  const dir = await fresh();
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  await commit_skill(prepared("External removal"));
  await set_skill_enabled("external-removal", false);
  await fs.rm(path.join(dir, "external-removal"), { recursive: true, force: true });
  await refresh_skills();
  await commit_skill(prepared("External removal", "fresh instructions"));
  assert.equal(skill_entries().find((entry) => entry.slug === "external-removal")?.enabled, true);
});

test("venv documentation and package entrypoints are never detected as a server", async () => {
  const dir = await fresh();
  await write(dir, ".venv/pyvenv.cfg");
  await write(dir, ".venv/Scripts/python.exe");
  await write(dir, '.venv/README.md', '```json\n{"command":"wrong-command","args":[]}\n```');
  await write(dir, ".venv/Lib/mcp/server.py");
  assert.equal((await detect_server(dir)).ok, false);
});

test("project source folders named env without a virtualenv marker are still scanned", async () => {
  const dir = await fresh();
  const entry = await write(dir, "env/mcp_server.py");
  const found = await detect_server(dir);
  assert.deepEqual(found.config.args, [entry]);
  assert.equal(found.config.command, "python");
});

test("a missing venv interpreter falls back to the normal Python executable", async () => {
  const dir = await fresh();
  await write(dir, ".venv/pyvenv.cfg");
  await write(dir, ".venv/Lib/mcp/server.py");
  const entry = await write(dir, "main.py");
  const found = await detect_server(dir);
  assert.deepEqual(found.config.args, [entry]);
  assert.equal(found.config.command, "python");
});

test("Windows does not attempt to launch an extensionless Unix venv interpreter", async () => {
  const dir = await fresh();
  await write(dir, ".venv/pyvenv.cfg");
  const python = await write(dir, ".venv/bin/python");
  await write(dir, "main.py");
  assert.equal((await detect_server(dir)).config.command, process.platform === "win32" ? "python" : python);
});

test("nested README remains a fallback when the root has no README", async () => {
  const dir = await fresh();
  const entry = await write(dir, "nested.js");
  await write(dir, "docs/README.rst", '```json\n{"command":"node","args":["nested.js"]}\n```');
  assert.deepEqual((await detect_server(dir)).config.args, [entry]);
});

test("legacy migration rejects directory links that hide executable payloads", async () => {
  const dir = await fresh();
  const legacy = path.join(dir, "legacy");
  const target = path.join(dir, "target");
  const external = path.join(dir, "external");
  await fs.mkdir(target);
  await write(legacy, "unsafe/SKILL.md", raw("Unsafe link"));
  await write(external, "start.ps1", "Write-Output fixture");
  await fs.symlink(external, path.join(legacy, "unsafe", "scripts"), "junction");
  assert.deepEqual(await import_legacy_skills(legacy, target), {});
  assert.deepEqual(await fs.readdir(target), []);
  assert.equal(await fs.readFile(path.join(external, "start.ps1"), "utf8"), "Write-Output fixture");
});

test("failed removal leaves the disabled state and skill contents intact", async (t) => {
  const dir = await fresh();
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  await commit_skill(prepared("Keep disabled"));
  await set_skill_enabled("keep-disabled", false);
  const remove = fs.rm.bind(fs);
  t.mock.method(fs, "rm", async (target: Parameters<typeof fs.rm>[0], options: Parameters<typeof fs.rm>[1]) => {
    if (String(target) === path.join(dir, "keep-disabled")) throw Object.assign(new Error("blocked removal"), { code: "EACCES" });
    return remove(target, options);
  });
  await assert.rejects(remove_skill("keep-disabled"), /blocked removal/);
  assert.equal(get_settings().skills.disabled.includes("keep-disabled"), true);
  assert.equal(skill_entries().find((entry) => entry.slug === "keep-disabled")?.enabled, false);
  assert.equal(await fs.readFile(path.join(dir, "keep-disabled", "SKILL.md"), "utf8"), raw("Keep disabled"));
});

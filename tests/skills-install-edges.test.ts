import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { detect_server } from "../electron/mcp/detect.ts";
import { import_legacy_skills } from "../electron/skills/legacy.ts";
import { commit_skill, init_skills, set_skill_enabled, skill_entries } from "../electron/skills/store.ts";
import { init_settings } from "../electron/settings/store.ts";

let root = "";
const write = async (relative: string, text: string) => { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); return file; };
const prepared = { name: "External", description: "fixture", raw: "---\nname: External\ndescription: fixture\n---\nInstructions\n", extras: [], source: "test", ref: "", commit: "", sha256: "test" };
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-skills-install-"));
  await init_settings({ files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "absent") }, codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher }, on_change: () => {} });
});
after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test("an externally removed skill is a fresh install even before a UI refresh", async () => {
  const dir = path.join(root, "skills");
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  await commit_skill(prepared);
  await set_skill_enabled("external", false);
  await fs.rm(path.join(dir, "external"), { recursive: true, force: true });
  await commit_skill(prepared);
  assert.equal(skill_entries().find((entry) => entry.slug === "external")?.enabled, true);
});

test("unreadable nested input aborts before copying a partial legacy skill", async (t) => {
  await write("legacy/blocked/SKILL.md", prepared.raw);
  await write("legacy/blocked/docs/note.md", "retained");
  const target = path.join(root, "migration");
  await fs.mkdir(target);
  const read = fs.readdir.bind(fs);
  t.mock.method(fs, "readdir", async (dir: Parameters<typeof fs.readdir>[0], options: any) => {
    if (String(dir) === path.join(root, "legacy/blocked/docs")) throw Object.assign(new Error("review denied nested directory"), { code: "EACCES" });
    return read(dir, options);
  });
  await assert.rejects(import_legacy_skills(path.join(root, "legacy"), target), /review denied/);
  assert.deepEqual(await fs.readdir(target), []);
  assert.equal(await fs.readFile(path.join(root, "legacy/blocked/SKILL.md"), "utf8"), prepared.raw);
});

test("case-variant virtualenv metadata cannot replace the root README or root entry", async () => {
  const dir = path.join(root, "detect");
  const entry = await write("detect/server.js", "root entry");
  await write("detect/README.TXT", '```json\n{"command":"node","args":["server.js"]}\n```');
  await write("detect/.VENV/PYVENV.CFG", "marker");
  await write("detect/.VENV/Scripts/python.exe", "interpreter");
  await write("detect/.VENV/Lib/mcp/server.py", "wrong entry");
  await write("detect/aaa/README.md", '```json\n{"command":"wrong","args":[]}\n```');
  await write("detect/aaa/server.js", "wrong duplicate");
  const found = await detect_server(dir);
  assert.equal(found.source, "readme");
  assert.equal(found.config.command, "node");
  assert.deepEqual(found.config.args, [entry]);
});

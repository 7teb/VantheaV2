import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { sweep_tmp, write_file_atomic, write_file_atomic_sync } from "../electron/storage/json-file.ts";
import { init_settings } from "../electron/settings/store.ts";
import { commit_skill, init_skills, install_target, skill_entries } from "../electron/skills/store.ts";
import { init_media, new_media_id, write_media } from "../electron/media/files.ts";

let root = "";
before(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "vx-storage-"));
  await init_settings({ files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "missing") }, codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher }, on_change: () => {} });
});
after(async () => { await fsp.rm(root, { recursive: true, force: true }); });

test("startup sweep preserves actual tmp attachments and removes only atomic-write leftovers", async () => {
  const dir = path.join(root, "media");
  await fsp.mkdir(dir);
  init_media({ attachments: dir, images: dir });
  const id = new_media_id("att", "tmp");
  await write_media("attachment", id, Buffer.from("retained attachment"));
  await fsp.writeFile(path.join(dir, "notes.tmp"), "user file");
  await fsp.writeFile(path.join(dir, "settings.json.4242.deadbeef.tmp"), "stale");
  assert.equal(await sweep_tmp([dir]), 1);
  assert.equal(await fsp.readFile(path.join(dir, id), "utf8"), "retained attachment");
  assert.equal(await fsp.readFile(path.join(dir, "notes.tmp"), "utf8"), "user file");
});

test("a rename submitted before sync publication cannot overwrite that newer publication", async (t) => {
  const file = path.join(root, "late.json");
  const rename = fsp.rename.bind(fsp);
  let release = () => {};
  let entered = () => {};
  const held = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(fsp, "rename", async (from: Parameters<typeof fsp.rename>[0], to: Parameters<typeof fsp.rename>[1]) => {
    if (String(to) === file) { entered(); await gate; }
    await rename(from, to);
  });
  const writing = write_file_atomic(file, "old async");
  try {
    await Promise.race([held, writing]);
    write_file_atomic_sync(file, "new sync");
  } finally { release(); }
  await writing;
  assert.equal(fs.readFileSync(file, "utf8"), "new sync");
});

test("case-only skill slug collisions are shown before install and preserve canonical folder identity", async () => {
  const dir = path.join(root, "skills");
  const existing = path.join(dir, "MiXeD");
  await fsp.mkdir(existing, { recursive: true });
  await fsp.writeFile(path.join(existing, "SKILL.md"), "---\nname: Existing Skill\ndescription: old\n---\nold instructions\n");
  await fsp.writeFile(path.join(existing, "old.txt"), "old helper");
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  const target = install_target("Mixed");
  assert.equal(target.replaces?.name, "Existing Skill");
  assert.equal(target.slug, "MiXeD");
  assert.equal(target.dir, existing);
  const installed = await commit_skill({ name: "Mixed", description: "new", raw: "---\nname: Mixed\ndescription: new\n---\nnew instructions\n", extras: [], source: "test", ref: "", commit: "", sha256: "test" });
  assert.equal(installed.slug, "MiXeD");
  assert.equal(skill_entries().length, 1);
  assert.equal(skill_entries()[0]?.error, "");
  assert.deepEqual((await fsp.readdir(dir)).filter((name) => name !== "installed.json"), ["MiXeD"]);
});

test("sweep ignores tmp directories, almost-matching names and unrelated suffixes", async () => {
  const dir = path.join(root, "sweep-edges");
  await fsp.mkdir(dir);
  const retained = ["plain.tmp", "notes.123.abcdefg.tmp", "notes.0.deadbeef.tmp", "notes.123.deadbeef.tmp.txt", "att_abc_def.tmp"];
  for (const name of retained) await fsp.writeFile(path.join(dir, name), "retain");
  await fsp.mkdir(path.join(dir, "folder.123.deadbeef.tmp"));
  await fsp.writeFile(path.join(dir, "folder.123.deadbeef.tmp", "child"), "retain child");
  await fsp.writeFile(path.join(dir, "data.vxc.123.deadbeef.tmp"), "stale");
  assert.equal(await sweep_tmp([dir, path.join(root, "absent-dir")]), 1);
  assert.deepEqual((await fsp.readdir(dir)).sort(), [...retained, "folder.123.deadbeef.tmp"].sort());
});

test("new async writes after a sync publication remain ordered and leave no staging files", async () => {
  const file = path.join(root, "ordered.bin");
  const old = write_file_atomic(file, Buffer.from("old"));
  write_file_atomic_sync(file, Buffer.from("sync"));
  const first = write_file_atomic(file, Buffer.from("first"));
  const last = write_file_atomic(file, Buffer.from("last"));
  await Promise.all([old, first, last]);
  assert.equal(await fsp.readFile(file, "utf8"), "last");
  assert.equal((await fsp.readdir(root)).some((name) => name.startsWith("ordered.bin.")), false);
});

test("case-collision install failure restores original bytes, helpers and registry", async (t) => {
  const dir = path.join(root, "rollback-skills");
  const existing = path.join(dir, "KeEp");
  const original = "---\nname: Original\ndescription: original\n---\nOriginal instructions\n";
  await fsp.mkdir(existing, { recursive: true });
  await fsp.writeFile(path.join(existing, "SKILL.md"), original);
  await fsp.writeFile(path.join(existing, "helper.txt"), "keep helper");
  await init_skills({ root: dir, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  const registry = await fsp.readFile(path.join(dir, "installed.json"));
  const rename = fsp.rename.bind(fsp);
  t.mock.method(fsp, "rename", async (from: Parameters<typeof fsp.rename>[0], to: Parameters<typeof fsp.rename>[1]) => {
    if (path.basename(String(from)).startsWith(".staging-")) throw Object.assign(new Error("staging full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  await assert.rejects(commit_skill({ name: "Keep", description: "new", raw: "---\nname: Keep\ndescription: new\n---\nnew\n", extras: [], source: "test", ref: "", commit: "", sha256: "test" }), /staging full/);
  assert.equal(await fsp.readFile(path.join(existing, "SKILL.md"), "utf8"), original);
  assert.equal(await fsp.readFile(path.join(existing, "helper.txt"), "utf8"), "keep helper");
  assert.deepEqual(await fsp.readFile(path.join(dir, "installed.json")), registry);
  assert.deepEqual((await fsp.readdir(dir)).sort(), ["KeEp", "installed.json"]);
});

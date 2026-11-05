import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { read_json, sweep_tmp, write_file_atomic, write_file_atomic_sync } from "../electron/storage/json-file.ts";
import { init_settings } from "../electron/settings/store.ts";
import { commit_skill, init_skills, install_target } from "../electron/skills/store.ts";

let root = "";
before(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "vx-storage-independent-"));
  await init_settings({ files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "missing") }, codec: { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher }, on_change: () => {} });
});
after(async () => { await fsp.rm(root, { recursive: true, force: true }); });

test("sweep skips matching directories and junctions and requires the full generated suffix", async () => {
  const dir = path.join(root, "sweep");
  const target = path.join(root, "junction-target");
  await fsp.mkdir(dir);
  await fsp.mkdir(target);
  await fsp.writeFile(path.join(target, "keep.txt"), "kept");
  await fsp.mkdir(path.join(dir, "folder.42.deadbeef.tmp"));
  await fsp.symlink(target, path.join(dir, "linked.42.deadbeef.tmp"), "junction");
  const keep = ["attachment.tmp", "foo.42.deadbee.tmp", "foo.42.deadbeefg.tmp", "foo.0.deadbeef.tmp", "foo.42.zzzzzzzz.tmp", "foo.42.deadbeef.tmp.txt"];
  for (const name of keep) await fsp.writeFile(path.join(dir, name), "kept");
  await fsp.writeFile(path.join(dir, "actual.json.42.deadbeef.tmp"), "stale");
  assert.equal(await sweep_tmp([dir, path.join(root, "missing")]), 1);
  assert.equal(await fsp.readFile(path.join(target, "keep.txt"), "utf8"), "kept");
  for (const name of [...keep, "folder.42.deadbeef.tmp", "linked.42.deadbeef.tmp"]) await fsp.lstat(path.join(dir, name));
});

test("sync publication during async rename retry supersedes the older bytes", async (t) => {
  const file = path.join(root, "retry.json");
  const rename = fs.renameSync;
  let blocked = false;
  let reached = () => {};
  const retrying = new Promise<void>((resolve) => { reached = resolve; });
  t.mock.method(fs, "renameSync", (from: Parameters<typeof fs.renameSync>[0], to: Parameters<typeof fs.renameSync>[1]) => {
    if (String(to) === file && !blocked) {
      blocked = true;
      reached();
      throw Object.assign(new Error("injected transient busy rename"), { code: "EBUSY" });
    }
    return rename(from, to);
  });
  const pending = write_file_atomic(file, "old async");
  await retrying;
  write_file_atomic_sync(file, "new sync");
  await pending;
  assert.equal(await fsp.readFile(file, "utf8"), "new sync");
  assert.equal((await fsp.readdir(root)).some((name) => name.startsWith("retry.json.") && name.endsWith(".tmp")), false);
});

test("failed synchronous publication preserves the existing canonical file and removes staging", async (t) => {
  const file = path.join(root, "sync-failed.json");
  await write_file_atomic(file, "original");
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from: Parameters<typeof fs.renameSync>[0], to: Parameters<typeof fs.renameSync>[1]) => {
    if (String(to) === file) throw Object.assign(new Error("injected disk full"), { code: "ENOSPC" });
    return rename(from, to);
  });
  assert.throws(() => write_file_atomic_sync(file, "replacement"), /disk full/);
  assert.equal(await fsp.readFile(file, "utf8"), "original");
  assert.equal((await fsp.readdir(root)).some((name) => name.startsWith("sync-failed.json.") && name.endsWith(".tmp")), false);
});

test("failed case-collision replacement restores the exact folder and registry", async (t) => {
  const skills = path.join(root, "skills");
  const existing = path.join(skills, "CASE-FOLDER");
  await fsp.mkdir(existing, { recursive: true });
  const original = "---\nname: Original\ndescription: old\n---\noriginal instructions\n";
  await fsp.writeFile(path.join(existing, "SKILL.md"), original);
  await fsp.writeFile(path.join(existing, "helper.txt"), "original helper");
  await init_skills({ root: skills, legacy_root: path.join(root, "absent"), builtin_root: path.join(root, "no-builtins") });
  const registry = await read_json(path.join(skills, "installed.json"));
  assert.equal(install_target("Case Folder").replaces?.name, "Original");
  const rename = fsp.rename;
  t.mock.method(fsp, "rename", async (from: Parameters<typeof fsp.rename>[0], to: Parameters<typeof fsp.rename>[1]) => {
    if (String(to) === existing && path.basename(String(from)).startsWith(".staging-")) throw Object.assign(new Error("injected replacement failure"), { code: "ENOSPC" });
    return rename(from, to);
  });
  await assert.rejects(commit_skill({ name: "Case Folder", description: "new", raw: "---\nname: Case Folder\ndescription: new\n---\nreplacement\n", extras: [], source: "fixture", ref: "", commit: "", sha256: "fixture" }), /replacement failure/);
  assert.equal(await fsp.readFile(path.join(existing, "SKILL.md"), "utf8"), original);
  assert.equal(await fsp.readFile(path.join(existing, "helper.txt"), "utf8"), "original helper");
  assert.deepEqual(await read_json(path.join(skills, "installed.json")), registry);
  assert.deepEqual((await fsp.readdir(skills)).filter((name) => name !== "installed.json"), ["CASE-FOLDER"]);
});

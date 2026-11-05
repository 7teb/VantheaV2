import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { prepare_path } from "../electron/skills/source.ts";
import {
  commit_skill,
  find_skill,
  init_skills,
  install_target,
  read_skill_raw,
  refresh_skills,
  remove_skill,
  set_skill_enabled,
  skill_entries,
  skills_prompt_section,
  usable_skills,
} from "../electron/skills/store.ts";
import { get_settings, init_settings } from "../electron/settings/store.ts";
import { skill_tools } from "../electron/tools/skills/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";

let root = "";
let counter = 0;

const skill_md = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing step by step.\n`;

const write_skill = async (dir: string, name: string, description = `Use for ${name}.`, extras: Record<string, string> = {}) => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), skill_md(name, description));
  for (const [file, content] of Object.entries(extras)) {
    await fs.writeFile(path.join(dir, file), content);
  }
};

const fresh_roots = async () => {
  counter += 1;
  const base = path.join(root, `case-${counter}`);
  const roots = { user: path.join(base, "user"), builtin: path.join(base, "builtin"), legacy: path.join(base, "legacy") };
  await fs.mkdir(roots.user, { recursive: true });
  await fs.mkdir(roots.builtin, { recursive: true });
  return roots;
};

const start = (roots: { user: string; builtin: string; legacy: string }) =>
  init_skills({ root: roots.user, legacy_root: roots.legacy, builtin_root: roots.builtin });

const exists = async (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-skill-groups-"));
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("group folders are scanned one level deep with group/skill slugs and broken children stay visible", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.user, "deploy"), "Deploy");
  await write_skill(path.join(roots.user, "designs", "glow"), "Glow", "Use for glow effects.", { "palette.md": "p" });
  await write_skill(path.join(roots.user, "designs", "blur"), "Blur");
  await fs.writeFile(path.join(roots.user, "designs", "README.md"), "loose file in a group");
  await fs.mkdir(path.join(roots.user, "designs", "missing"));
  await write_skill(path.join(roots.user, "designs", "nested", "deeper"), "Deeper");
  await fs.mkdir(path.join(roots.user, "empty"));
  await write_skill(path.join(roots.user, "effects", "shake"), "Shake");
  await start(roots);
  assert.deepEqual(
    skill_entries().map((entry) => [entry.slug, entry.group, entry.error]),
    [
      ["deploy", "", ""],
      ["empty", "", "no SKILL.md in this folder"],
      ["designs/blur", "designs", ""],
      ["designs/missing", "designs", "no SKILL.md in this folder"],
      ["designs/nested", "designs", "no SKILL.md in this folder"],
      ["designs/glow", "designs", ""],
      ["effects/shake", "effects", ""],
    ],
  );
  const glow = find_skill("glow");
  assert.equal(glow?.slug, "designs/glow");
  assert.equal(glow?.dir, path.join(roots.user, "designs", "glow"));
  assert.deepEqual(glow?.files, ["palette.md"]);
  assert.equal(find_skill("designs/glow")?.name, "Glow");
  assert.equal(find_skill("Deeper"), null);
  assert.equal(await read_skill_raw("designs/blur"), skill_md("Blur", "Use for Blur."));
  assert.match((await skills_prompt_section())?.body ?? "", /- Glow: Use for glow effects\./);
});

test("duplicate names become broken with built-in before root before groups", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.builtin, "guide"), "Guide");
  await write_skill(path.join(roots.user, "guide"), "guide", "Shadows the built-in.");
  await write_skill(path.join(roots.user, "zeta"), "Shared");
  await write_skill(path.join(roots.user, "alpha", "shared"), "Shared");
  await write_skill(path.join(roots.user, "alpha", "twice"), "Twice");
  await write_skill(path.join(roots.user, "beta", "twice"), "Twice");
  await start(roots);
  const errors = Object.fromEntries(skill_entries().map((entry) => [entry.slug, entry.error]));
  assert.deepEqual(errors, {
    "builtin:guide": "",
    guide: "duplicate skill name, already used by builtin:guide",
    zeta: "",
    "alpha/shared": "duplicate skill name, already used by zeta",
    "alpha/twice": "",
    "beta/twice": "duplicate skill name, already used by alpha/twice",
  });
  assert.equal(find_skill("guide")?.slug, "builtin:guide");
  assert.equal(find_skill("shared")?.slug, "zeta");
  assert.equal(usable_skills().length, 3);
});

test("built-in skills are flagged, listed first, enabled by default, can be disabled and are never removed", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.builtin, "vantheax"), "VantheaX", "Use for questions about VantheaX.", { "settings.md": "s" });
  await write_skill(path.join(roots.builtin, "app", "tools"), "App Tools");
  await write_skill(path.join(roots.user, "aaa"), "Aaa");
  await start(roots);
  const entries = skill_entries();
  assert.deepEqual(
    entries.map((entry) => [entry.slug, entry.builtin, entry.group, entry.enabled, entry.source]),
    [
      ["builtin:vantheax", true, "", true, ""],
      ["builtin:app/tools", true, "app", true, ""],
      ["aaa", false, "", true, ""],
    ],
  );
  await assert.rejects(remove_skill("builtin:vantheax"), /built-in skill .* cannot be removed/);
  assert.equal(await exists(path.join(roots.builtin, "vantheax", "SKILL.md")), true);
  assert.throws(() => install_target("vantheax"), /built-in skill/);
  await assert.rejects(commit_skill(await prepare_path(path.join(roots.builtin, "vantheax"))), /built-in skill/);
  assert.deepEqual(await fs.readdir(roots.user), ["aaa", "installed.json"]);
  const prompt = (await skills_prompt_section())?.body ?? "";
  assert.match(prompt, /ship with VantheaX as built-in skills, the user installed and approved the others/);
  assert.match(prompt, /authoritative procedural instructions/);
  await set_skill_enabled("builtin:vantheax", false);
  assert.equal(find_skill("VantheaX"), null);
  assert.equal(skill_entries()[0]?.enabled, false);
  await set_skill_enabled("builtin:vantheax", true);
  assert.equal(find_skill("VantheaX")?.builtin, true);
});

test("a grouped skill can be disabled and enabled by its group/skill slug", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.user, "designs", "glow"), "Glow");
  await write_skill(path.join(roots.user, "shine"), "Shine");
  await start(roots);
  await set_skill_enabled("designs/glow", false);
  assert.equal(find_skill("Glow"), null);
  assert.equal(find_skill("Shine")?.slug, "shine");
  assert.deepEqual(
    skill_entries().map((entry) => [entry.slug, entry.enabled]),
    [
      ["shine", true],
      ["designs/glow", false],
    ],
  );
  await set_skill_enabled("designs/glow", true);
  assert.equal(find_skill("Glow")?.slug, "designs/glow");
});

test("provenance follows a skill moved into a group and the record key is rewritten", async () => {
  const roots = await fresh_roots();
  await start(roots);
  const source = path.join(root, `source-${counter}`);
  await write_skill(source, "Glow", "Use for glow v1.", { "notes.md": "v1" });
  await commit_skill(await prepare_path(source));
  await fs.mkdir(path.join(roots.user, "designs"));
  await fs.rename(path.join(roots.user, "glow"), path.join(roots.user, "designs", "glow"));
  await refresh_skills();
  const entry = skill_entries().find((item) => item.slug === "designs/glow");
  assert.equal(entry?.source, source);
  const stored = JSON.parse(await fs.readFile(path.join(roots.user, "installed.json"), "utf8"));
  assert.deepEqual(Object.keys(stored.skills), ["designs/glow"]);
  assert.equal(stored.skills["designs/glow"].source, source);
  await write_skill(source, "Glow", "Use for glow v2.", { "notes.md": "v2" });
  assert.equal(install_target("Glow").slug, "designs/glow");
  await commit_skill(await prepare_path(source));
  assert.equal(await fs.readFile(path.join(roots.user, "designs", "glow", "notes.md"), "utf8"), "v2");
  assert.equal(await exists(path.join(roots.user, "glow")), false);
  assert.deepEqual((await fs.readdir(roots.user)).filter((name) => name.startsWith(".")), []);
  await remove_skill("designs/glow");
  assert.equal(await exists(path.join(roots.user, "designs")), false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(roots.user, "installed.json"), "utf8")).skills, {});
});

test("slug-taking functions only resolve scanned entries, never a path built from the slug", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.user, "designs", "glow"), "Glow");
  const outside = path.join(path.dirname(roots.user), "outside");
  await write_skill(outside, "Outside");
  await start(roots);
  for (const slug of ["../outside", "..\\outside", "designs/../../outside", "designs", "designs/glow/..", "/designs/glow", "DESIGNS/GLOW", ""]) {
    await assert.rejects(read_skill_raw(slug), /unknown skill/);
    await assert.rejects(set_skill_enabled(slug, false), /unknown skill/);
    await assert.rejects(remove_skill(slug), /unknown skill/);
  }
  assert.equal(await exists(path.join(outside, "SKILL.md")), true);
  assert.equal(await exists(path.join(roots.user, "designs", "glow", "SKILL.md")), true);
});

test("the skill limit counts built-in, root and grouped skills together", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.builtin, "guide"), "Guide");
  for (let index = 0; index < 150; index += 1) {
    await write_skill(path.join(roots.user, `s${String(index).padStart(3, "0")}`), `Skill ${index}`);
  }
  for (let index = 0; index < 60; index += 1) {
    await write_skill(path.join(roots.user, "group", `g${String(index).padStart(3, "0")}`), `Grouped ${index}`);
  }
  await start(roots);
  const entries = skill_entries();
  assert.equal(entries.length, 200);
  assert.equal(entries.filter((entry) => entry.builtin).length, 1);
  assert.equal(entries.filter((entry) => entry.group === "group").length, 49);
});

test("installing a skill named like a group folder is refused and leaves the group intact", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.user, "Designs", "glow"), "Glow");
  await start(roots);
  const source = path.join(root, `source-${counter}`);
  await write_skill(source, "designs");
  assert.throws(() => install_target("designs"), /group folder named designs/);
  await assert.rejects(commit_skill(await prepare_path(source)), /group folder named designs/);
  assert.equal(await exists(path.join(roots.user, "Designs", "glow", "SKILL.md")), true);
});

test("a disabled skill stays disabled when its folder moves into a group", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.user, "glow"), "Glow");
  await write_skill(path.join(roots.user, "shine"), "Shine");
  await start(roots);
  await set_skill_enabled("glow", false);
  await fs.mkdir(path.join(roots.user, "designs"));
  await fs.rename(path.join(roots.user, "glow"), path.join(roots.user, "designs", "glow"));
  await refresh_skills();
  assert.equal(find_skill("Glow"), null);
  assert.equal(find_skill("Shine")?.slug, "shine");
  assert.deepEqual(get_settings().skills.disabled, ["designs/glow"]);
  await set_skill_enabled("designs/glow", true);
  assert.deepEqual(get_settings().skills.disabled, []);
});

test("the scan skips junctions in the root and inside groups", async () => {
  const roots = await fresh_roots();
  const outside = path.join(path.dirname(roots.user), "linked-outside");
  await write_skill(path.join(outside, "evil"), "Evil");
  await write_skill(path.join(roots.user, "designs", "glow"), "Glow");
  await fs.symlink(path.join(outside, "evil"), path.join(roots.user, "linked"), "junction");
  await fs.symlink(path.join(outside, "evil"), path.join(roots.user, "designs", "linked"), "junction");
  await fs.symlink(outside, path.join(roots.user, "grouplink"), "junction");
  await start(roots);
  assert.deepEqual(
    skill_entries().map((entry) => entry.slug),
    ["designs/glow"],
  );
});

test("read_skill returns a listed extra file and nothing outside the list", async () => {
  const roots = await fresh_roots();
  await write_skill(path.join(roots.builtin, "guide"), "Guide", "Use for the guide.", { "app.md": "# App facts" });
  await write_skill(path.join(roots.user, "designs", "glow"), "Glow");
  await fs.writeFile(path.join(roots.builtin, "secret.md"), "outside the skill");
  await start(roots);
  const read_skill = skill_tools.find((tool) => tool.spec.name === "read_skill");
  assert.ok(read_skill);
  const ctx = {} as ToolContext;
  const main = await read_skill.execute(ctx, { name: "Guide" });
  assert.match(main.text, /Extra files \(load one with read_skill and file\): app\.md/);
  const extra = await read_skill.execute(ctx, { name: "guide", file: "APP.md" });
  assert.equal(extra.status, "done");
  assert.match(extra.text, /FILE "app\.md" of the skill "Guide":\n\n# App facts$/);
  for (const file of ["../secret.md", "SKILL.md", "missing.md", "..\guide\app.md"]) {
    const refused = await read_skill.execute(ctx, { name: "Guide", file });
    assert.equal(refused.status, "failed");
    assert.match(refused.text, /has no extra file/);
  }
  const none = await read_skill.execute(ctx, { name: "Glow", file: "app.md" });
  assert.match(none.text, /It has no extra files\./);
});

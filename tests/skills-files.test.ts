import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { find_skill, init_skills, skill_entries, skills_prompt_section } from "../electron/skills/store.ts";
import { init_settings } from "../electron/settings/store.ts";
import { skill_tools } from "../electron/tools/skills/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";

let root = "";
let counter = 0;

const write = async (file: string, content: string) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};

const skill_md = (name: string) => `---\nname: ${name}\ndescription: Use for ${name}.\n---\n\nDo the thing.\n`;

const fresh_roots = async () => {
  counter += 1;
  const base = path.join(root, `case-${counter}`);
  const roots = { user: path.join(base, "user"), builtin: path.join(base, "builtin"), legacy: path.join(base, "legacy") };
  await fs.mkdir(roots.user, { recursive: true });
  await fs.mkdir(roots.builtin, { recursive: true });
  return roots;
};

const read_skill = () => {
  const tool = skill_tools.find((entry) => entry.spec.name === "read_skill");
  assert.ok(tool);
  return tool;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-skill-files-"));
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

test("extra files are listed flat first, then text files one subfolder deep", async () => {
  const roots = await fresh_roots();
  const dir = path.join(roots.builtin, "design", "lab");
  await write(path.join(dir, "SKILL.md"), skill_md("Lab"));
  await write(path.join(dir, "notes.md"), "flat notes");
  await write(path.join(dir, "styles", "neon.md"), "# Neon card");
  await write(path.join(dir, "styles", "Glow.MD"), "# Glow card");
  await write(path.join(dir, "kit", "helpers.js"), "const x = 1;");
  await write(path.join(dir, "kit", "logo.png"), "binary");
  await write(path.join(dir, "kit", ".hidden.md"), "hidden");
  await write(path.join(dir, ".git", "config.md"), "dot folder");
  await write(path.join(dir, "styles", "deeper", "inner.md"), "two levels down");
  const outside = path.join(root, `outside-${counter}`);
  await write(path.join(outside, "secret.md"), "outside");
  await fs.symlink(outside, path.join(dir, "linked"), "junction");
  await init_skills({ root: roots.user, legacy_root: roots.legacy, builtin_root: roots.builtin });
  assert.deepEqual(find_skill("Lab")?.files, ["notes.md", "kit/helpers.js", "styles/Glow.MD", "styles/neon.md"]);
  const main = await read_skill().execute({} as ToolContext, { name: "Lab" });
  assert.match(main.text, new RegExp(`\\nSkill folder: ${dir.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\n`));
  assert.match(main.text, /Extra files \(load one with read_skill and file\): notes\.md, kit\/helpers\.js, styles\/Glow\.MD, styles\/neon\.md/);
});

test("read_skill reads a nested file by its listed path and refuses everything else", async () => {
  const roots = await fresh_roots();
  const dir = path.join(roots.user, "lab");
  await write(path.join(dir, "SKILL.md"), skill_md("Lab"));
  await write(path.join(dir, "styles", "neon.md"), "# Neon card");
  await write(path.join(dir, "styles", "huge.md"), "x".repeat(100 * 1024 + 1));
  await write(path.join(dir, "styles", "deeper", "inner.md"), "two levels down");
  await write(path.join(roots.user, "secret.md"), "outside the skill");
  await init_skills({ root: roots.user, legacy_root: roots.legacy, builtin_root: roots.builtin });
  const ctx = {} as ToolContext;
  for (const file of ["styles/neon.md", "STYLES/NEON.md", "styles\\neon.md", " styles/neon.md "]) {
    const read = await read_skill().execute(ctx, { name: "Lab", file });
    assert.equal(read.status, "done");
    assert.match(read.text, /FILE "styles\/neon\.md" of the skill "Lab":\n\n# Neon card$/);
  }
  const huge = await read_skill().execute(ctx, { name: "Lab", file: "styles/huge.md" });
  assert.equal(huge.status, "failed");
  assert.match(huge.text, /is 102401 bytes, read_skill returns extra files up to 102400 bytes/);
  for (const file of ["styles/../../secret.md", "../secret.md", "styles/deeper/inner.md", "styles", "styles/", "neon.md", "styles/SKILL.md"]) {
    const refused = await read_skill().execute(ctx, { name: "Lab", file });
    assert.equal(refused.status, "failed");
    assert.match(refused.text, /has no extra file/);
  }
});

test("the shipped effects-lab skill loads in the design group with its cards readable", async () => {
  const roots = await fresh_roots();
  await init_skills({ root: roots.user, legacy_root: roots.legacy, builtin_root: path.resolve("skills") });
  const entry = skill_entries().find((item) => item.slug === "builtin:design/effects-lab");
  assert.equal(entry?.error, "");
  assert.equal(entry?.group, "design");
  const skill = find_skill("effects-lab");
  assert.ok(skill);
  const cards = skill.files.filter((file) => file.startsWith("styles/"));
  assert.equal(cards.length, 21);
  assert.ok(skill.files.includes("kit/helpers.js"));
  assert.ok(skill.files.includes("tools/check.py"));
  assert.match((await skills_prompt_section())?.body ?? "", /^- effects-lab: Build polished visual effect pages/m);
  const card = await read_skill().execute({} as ToolContext, { name: "effects-lab", file: "styles/neon_glow.md" });
  assert.equal(card.status, "done");
  assert.match(card.text, /^FILE "styles\/neon_glow\.md" of the skill "effects-lab":\n\n# /);
});

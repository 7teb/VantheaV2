import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { parse_frontmatter, parse_skill_file } from "../electron/skills/frontmatter.ts";
import { prepare_path, prepare_skill } from "../electron/skills/source.ts";
import { commit_skill, find_skill, init_skills, remove_skill, skill_entries, skills_prompt_section } from "../electron/skills/store.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";

let root = "";
let no_builtins = "";
let counter = 0;

const skill_md = (name: string, description: string, body = "Do the thing step by step.") => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

const dir_in = async (label: string) => {
  counter += 1;
  const dir = path.join(root, `${label}-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const write_skill = async (dir: string, files: Record<string, string>) => {
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content);
  }
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-skills-"));
  no_builtins = path.join(root, "builtin");
  await fs.mkdir(no_builtins);
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

test("folded and literal block scalars parse into one value instead of a lone > or |", () => {
  const meta = parse_frontmatter(
    [
      "name: pdf-tools",
      "description: >-",
      "  Use this skill when the user wants to",
      "  merge or split PDF files.",
      "",
      "  Not for Word documents.",
      "notes: |",
      "  line one",
      "    indented two",
      "license: MIT # trailing comment",
    ].join("\n"),
  );
  assert.equal(meta.description, "Use this skill when the user wants to merge or split PDF files.\nNot for Word documents.");
  assert.equal(meta.notes, "line one\n  indented two");
  assert.equal(meta.license, "MIT");
  assert.equal(meta.name, "pdf-tools");
});

test("quoted, multi-line plain and nested values parse like YAML", () => {
  const meta = parse_frontmatter(
    [
      'Name: "Quoted \\"name\\""',
      "description: 'It''s single quoted: yes'",
      "summary: starts here",
      "  and continues",
      "metadata:",
      "  author: someone",
      "  version: 2",
      "# a comment: ignored",
      "plain: value: with colon",
    ].join("\n"),
  );
  assert.equal(meta.name, 'Quoted "name"');
  assert.equal(meta.description, "It's single quoted: yes");
  assert.equal(meta.summary, "starts here and continues");
  assert.equal(meta.metadata, "");
  assert.equal(meta.plain, "value: with colon");
  assert.equal(Object.hasOwn(meta, "# a comment"), false);
});

test("a skill description of any length parses", () => {
  const description = "Use it when the task needs this. ".repeat(200).trim();
  const parsed = parse_skill_file(skill_md("Long Skill", description));
  assert.equal(parsed.ok ? parsed.skill.description : parsed.error, description);
});

test("parse_skill_file handles BOM and CRLF and reports precise errors", () => {
  const parsed = parse_skill_file(`\uFEFF---\r\nname: Win Skill\r\ndescription: >\r\n  folded on\r\n  windows\r\n---\r\nBody text\r\n`);
  assert.deepEqual(parsed, { ok: true, skill: { name: "Win Skill", description: "folded on windows", body: "Body text" } });
  assert.deepEqual(parse_skill_file("no frontmatter"), { ok: false, error: "SKILL.md must start with a YAML frontmatter block delimited by ---" });
  assert.deepEqual(parse_skill_file("---\nname: x\n"), { ok: false, error: "SKILL.md frontmatter is never closed with ---" });
  const no_description = parse_skill_file("---\nname: x\n---\nbody");
  assert.equal(no_description.ok, false);
  assert.match(no_description.ok ? "" : no_description.error, /no description/);
  const empty_body = parse_skill_file("---\nname: x\ndescription: y\n---\n\n");
  assert.equal(empty_body.ok ? "" : empty_body.error, "SKILL.md has frontmatter but no body");
  const folded_only = parse_skill_file("---\nname: x\ndescription: >\n---\nbody");
  assert.match(folded_only.ok ? "" : folded_only.error, /no description/);
});

test("prepare_path reads the skill and its plain extras and rejects executables and relative paths", async () => {
  const source = await dir_in("source");
  await write_skill(source, { "SKILL.md": skill_md("Deploy Helper", "Use when deploying."), "notes.md": "extra notes", "image.png": "x", ".hidden.md": "h" });
  const prepared = await prepare_path(source);
  assert.equal(prepared.name, "Deploy Helper");
  assert.deepEqual(prepared.extras, [{ name: "notes.md", content: "extra notes" }]);
  assert.equal(prepared.source, source);
  assert.match(prepared.sha256, /^[0-9a-f]{64}$/);
  await fs.writeFile(path.join(source, "run.ps1"), "Remove-Item");
  await assert.rejects(prepare_path(source), /executable files \(run\.ps1\)/);
  await assert.rejects(prepare_skill("relative/skill", new AbortController().signal), /absolute path/);
});

test("commit installs through a staging folder, replaces an existing skill and records the source atomically", async () => {
  const skills = await dir_in("skills");
  await init_skills({ root: skills, legacy_root: path.join(skills, "missing-legacy"), builtin_root: no_builtins });
  const source = await dir_in("source");
  await write_skill(source, { "SKILL.md": skill_md("Deploy Helper", "Use when deploying."), "notes.md": "v1" });
  const installed = await commit_skill(await prepare_path(source));
  assert.equal(installed.slug, "deploy-helper");
  assert.equal(await fs.readFile(path.join(skills, "deploy-helper", "notes.md"), "utf8"), "v1");
  await write_skill(source, { "SKILL.md": skill_md("Deploy Helper", "Use when deploying v2."), "notes.md": "v2" });
  await commit_skill(await prepare_path(source));
  assert.equal(await fs.readFile(path.join(skills, "deploy-helper", "notes.md"), "utf8"), "v2");
  const leftovers = (await fs.readdir(skills)).filter((name) => name.startsWith("."));
  assert.deepEqual(leftovers, []);
  const registry = JSON.parse(await fs.readFile(path.join(skills, "installed.json"), "utf8"));
  assert.equal(registry.version, 1);
  assert.equal(registry.skills["deploy-helper"].source, source);
  const entries = skill_entries();
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    slug: "deploy-helper",
    name: "Deploy Helper",
    description: "Use when deploying v2.",
    enabled: true,
    files: ["notes.md"],
    source,
    error: "",
    builtin: false,
    group: "",
  });
  await remove_skill("deploy-helper");
  assert.deepEqual(skill_entries(), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(skills, "installed.json"), "utf8")).skills, {});
});

test("broken folders are listed with their error and disabled skills drop out of the prompt", async () => {
  const skills = await dir_in("skills");
  await write_skill(path.join(skills, "good"), { "SKILL.md": skill_md("Good Skill", "Use for good things.") });
  await write_skill(path.join(skills, "broken"), { "SKILL.md": "---\nname: Broken\n---\nbody" });
  await fs.mkdir(path.join(skills, "empty"));
  await init_skills({ root: skills, legacy_root: path.join(skills, "missing-legacy"), builtin_root: no_builtins });
  const entries = skill_entries();
  assert.deepEqual(entries.map((entry) => [entry.slug, entry.enabled, entry.error !== ""]), [
    ["broken", false, true],
    ["empty", false, true],
    ["good", true, false],
  ]);
  assert.equal(find_skill("good skill")?.slug, "good");
  assert.match((await skills_prompt_section())?.body ?? "", /- Good Skill: Use for good things\./);
  await update_settings({ skills: { disabled: ["good"] } });
  assert.equal(find_skill("Good Skill"), null);
  assert.equal(await skills_prompt_section(), null);
  await update_settings({ skills: { disabled: [] } });
});

test("legacy skills are imported once with their recorded source, skipping executables", async () => {
  const legacy = await dir_in("legacy");
  await write_skill(path.join(legacy, "old-skill"), { "SKILL.md": skill_md("Old Skill", "Use for old things."), "ref.md": "r" });
  await write_skill(path.join(legacy, "tooled"), { "SKILL.md": skill_md("Tooled", "Has a script."), "x.exe": "MZ" });
  await fs.writeFile(path.join(legacy, "installed.json"), JSON.stringify({ "old-skill": { source: "https://github.com/a/b", installedAt: "2026-01-01T00:00:00.000Z" } }));
  const skills = await dir_in("skills");
  await init_skills({ root: skills, legacy_root: legacy, builtin_root: no_builtins });
  assert.deepEqual(skill_entries().map((entry) => [entry.slug, entry.source]), [["old-skill", "https://github.com/a/b"]]);
  assert.equal(await fs.readFile(path.join(skills, "old-skill", "ref.md"), "utf8"), "r");
  await write_skill(path.join(legacy, "later"), { "SKILL.md": skill_md("Later", "Added after import.") });
  await init_skills({ root: skills, legacy_root: legacy, builtin_root: no_builtins });
  assert.deepEqual(skill_entries().map((entry) => entry.slug), ["old-skill"]);
  assert.equal(await fs.readFile(path.join(legacy, "old-skill", "SKILL.md"), "utf8"), skill_md("Old Skill", "Use for old things."));
});

test("prepare_skill reads a GitHub folder through the contents API with an injected fetch", async () => {
  const requests: string[] = [];
  const responses: Record<string, string> = {
    "https://api.github.com/repos/acme/skills/contents/tools/pdf?ref=main": JSON.stringify([
      { type: "file", name: "SKILL.md", size: 80, download_url: "https://raw.githubusercontent.com/acme/skills/main/tools/pdf/SKILL.md", sha: "abc" },
      { type: "file", name: "forms.md", size: 10, download_url: "https://raw.githubusercontent.com/acme/skills/main/tools/pdf/forms.md", sha: "def" },
      { type: "dir", name: "scripts", size: 0, download_url: "", sha: "x" },
    ]),
    "https://raw.githubusercontent.com/acme/skills/main/tools/pdf/SKILL.md": skill_md("PDF", "Use for PDFs."),
    "https://raw.githubusercontent.com/acme/skills/main/tools/pdf/forms.md": "forms",
  };
  const prepared = await prepare_skill("https://github.com/acme/skills/tree/main/tools/pdf", new AbortController().signal, async (url) => {
    requests.push(url);
    const body = responses[url];
    if (body === undefined) {
      throw new Error(`unexpected ${url}`);
    }
    return body;
  });
  assert.equal(prepared.name, "PDF");
  assert.equal(prepared.ref, "main");
  assert.equal(prepared.commit, "abc");
  assert.deepEqual(prepared.extras, [{ name: "forms.md", content: "forms" }]);
  assert.equal(requests[0], "https://api.github.com/repos/acme/skills/contents/tools/pdf?ref=main");
});

test("file names that are not plain names are rejected before anything leaves the skill folder", async () => {
  for (const name of ["a\\..\\..\\x.json", "notes/../../x.md", "x.md:stream.md"]) {
    const listing = JSON.stringify([
      { type: "file", name: "SKILL.md", size: 80, download_url: "https://raw.example/SKILL.md", sha: "abc" },
      { type: "file", name, size: 10, download_url: "https://raw.example/extra", sha: "def" },
    ]);
    const responses: Record<string, string> = {
      "https://api.github.com/repos/acme/skills/contents/evil": listing,
      "https://raw.example/SKILL.md": skill_md("Evil", "Escapes."),
      "https://raw.example/extra": "payload",
    };
    await assert.rejects(
      prepare_skill("https://github.com/acme/skills/tree/main/evil", new AbortController().signal, async (url) => responses[url.replace("?ref=main", "")] ?? ""),
      /not a plain file name/,
    );
  }
  const skills = await dir_in("skills");
  await init_skills({ root: skills, legacy_root: path.join(skills, "missing-legacy"), builtin_root: no_builtins });
  for (const name of ["a\\..\\..\\x.json", "..\\x.md", "../x.md", ".."]) {
    const prepared = { name: "Evil", description: "Escapes.", raw: skill_md("Evil", "Escapes."), extras: [{ name, content: "payload" }], source: "test", ref: "", commit: "", sha256: "" };
    await assert.rejects(commit_skill(prepared), /outside the skill folder/);
  }
  assert.deepEqual(await fs.readdir(skills), ["installed.json"]);
});

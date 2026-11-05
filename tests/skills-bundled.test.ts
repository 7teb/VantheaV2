import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { parse_skill_file } from "../electron/skills/frontmatter.ts";

const skills_root = path.join(import.meta.dirname, "..", "skills");

const skill_files = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => skill_files(path.join(dir, entry.name))));
  return [...entries.filter((entry) => entry.isFile() && entry.name === "SKILL.md").map((entry) => path.join(dir, entry.name)), ...nested.flat()];
};

test("every bundled skill parses with the frontmatter rules the app applies", async () => {
  const files = await skill_files(skills_root);
  assert.ok(files.some((file) => path.basename(path.dirname(file)) === "vantheax"));
  for (const file of files) {
    const parsed = parse_skill_file(await fs.readFile(file, "utf8"));
    assert.ok(parsed.ok, `${file}: ${parsed.ok ? "" : parsed.error}`);
  }
});

test("the vantheax skill description names the /review command", async () => {
  const parsed = parse_skill_file(await fs.readFile(path.join(skills_root, "vantheax", "SKILL.md"), "utf8"));
  assert.ok(parsed.ok);
  assert.match(parsed.skill.description, /Review \(\/review\)/);
});

test("the deep-research skill caps the team and ships the instructions its sub-agents load", async () => {
  const dir = path.join(skills_root, "deep-research");
  const parsed = parse_skill_file(await fs.readFile(path.join(dir, "SKILL.md"), "utf8"));
  assert.ok(parsed.ok);
  assert.equal(parsed.skill.name, "deep-research");
  const body = parsed.skill.body;
  assert.match(body, /Hard limits: at most 8 researchers in this step, at most 3 more in step 5, and exactly one report writer\. That is never more than 12 agents for one request\./);
  assert.match(body, /A long list gets clusters, never one researcher per item\./);
  assert.match(body, /call read_skill with name "deep-research" and file "researcher\.md"/);
  assert.match(body, /call read_skill with name "deep-research" and file "report-writer\.md"/);
  assert.match(body, /`model`: leave it out, so the researcher runs on your own model\./);
  assert.match(body, /While the researchers run, do no research of your own: no web_search, no browser, no reading of their notes files\./);
  assert.match(body, /Do not start more research after the writer has finished, unless the user asks for it\./);
  assert.match(body, /set up exactly like in step 4 \(worker without shell tools, `model` left out, `effort` medium\)/);
  assert.match(body, /Never do the research yourself\./);
  for (const file of ["researcher.md", "report-writer.md"]) {
    assert.ok((await fs.stat(path.join(dir, file))).size > 1000, file);
  }
});

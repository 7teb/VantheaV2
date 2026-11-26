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

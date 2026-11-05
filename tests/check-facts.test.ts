import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { count_brief_scenes, page_facts } from "../electron/check/facts.ts";

const folder_with = async (files: Record<string, string>) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vx-check-facts-"));
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await fs.writeFile(path.join(folder, name), text);
  }
  return folder;
};

test("brief scenes are counted with parse_brief's scene line rule", () => {
  assert.equal(count_brief_scenes("subject: coffee\nscene 1: calm (4s)\n  Scene2 : rush (3s)\r\nscene 3:\nscenes 4: no\nscene x: no\nscene 5 : last (2s)"), 3);
  assert.equal(count_brief_scenes(""), 0);
});

test("an ad reads its scene count from brief.md, a single style page never does", async () => {
  const ad = await folder_with({
    "index.html": '<div class="ad" data-format="16:9"></div>',
    "brief.md": "scene 1: a (4s)\nscene 2: b (4s)\n",
    "app.js": "const tl = timeline(ad, scenes);",
    "helpers.js": "function timeline() {}",
  });
  assert.deepEqual(await page_facts(ad), { is_ad: true, brief_scenes: 2, uses_timeline: true });
  const page = await folder_with({ "index.html": '<main class="page"><div class="stage"></div></main>', "brief.md": "scene 1: a (4s)\n", "app.js": "init();" });
  assert.deepEqual(await page_facts(page), { is_ad: false, brief_scenes: 0, uses_timeline: false });
  const no_brief = await folder_with({ "index.html": '<div class="ad"></div>' });
  assert.deepEqual(await page_facts(no_brief), { is_ad: true, brief_scenes: 0, uses_timeline: false });
});

test("timeline( only counts in the page's own scripts, never in helpers.js, subfolders or other file types", async () => {
  const folder = await folder_with({
    "index.html": "<script>timeline(x)</script>",
    "helpers.js": "timeline(",
    "lib/extra.js": "timeline(",
    "notes.txt": "timeline(",
    ".js": "timeline(",
    "main.mjs": "timeline(",
  });
  assert.equal((await page_facts(folder)).uses_timeline, false);
  await fs.writeFile(path.join(folder, "scenes.js"), "export const t = timeline(a, b);");
  assert.equal((await page_facts(folder)).uses_timeline, true);
});

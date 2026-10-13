import fs from "node:fs/promises";
import path from "node:path";
import { error_code } from "../storage/coerce.ts";

export type PageFacts = { is_ad: boolean; brief_scenes: number; uses_timeline: boolean };

const line_break = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

const scene_line = /^scene\s*\p{Nd}+\s*:\s*.+$/iu;

const read_or_null = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const count_brief_scenes = (brief: string): number => brief.split(line_break).filter((line) => scene_line.test(line.trim())).length;

export const page_facts = async (folder: string): Promise<PageFacts> => {
  const html = await fs.readFile(path.join(folder, "index.html"), "utf8");
  const is_ad = html.includes('class="ad');
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const scripts = entries.filter((entry) => entry.isFile() && path.extname(entry.name) === ".js" && entry.name !== "helpers.js");
  const sources = await Promise.all(scripts.map((entry) => fs.readFile(path.join(folder, entry.name), "utf8")));
  const brief = is_ad ? await read_or_null(path.join(folder, "brief.md")) : null;
  return { is_ad, brief_scenes: brief === null ? 0 : count_brief_scenes(brief), uses_timeline: sources.some((source) => source.includes("timeline(")) };
};

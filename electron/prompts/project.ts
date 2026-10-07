import fs from "node:fs/promises";
import path from "node:path";

export type ProjectDoc = { name: string; content: string };

const doc_candidates = ["AGENTS.md", "CLAUDE.md"];

const max_doc_chars = 24000;

const ignored_dirs = new Set([".git", "node_modules", "dist", "build", ".vs", ".idea", ".vscode", "bin", "obj", "target", ".cache"]);

const max_listing_entries = 200;

export const load_project_doc = async (root: string): Promise<ProjectDoc | null> => {
  if (!root.trim()) {
    return null;
  }
  for (const name of doc_candidates) {
    try {
      const raw = await fs.readFile(path.join(root, name), "utf8");
      const text = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();
      if (!text) {
        continue;
      }
      const content = text.length > max_doc_chars ? `${text.slice(0, max_doc_chars)}\n...[${name} truncated to fit context]` : text;
      return { name, content };
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        console.warn(`[prompts] reading ${name} in ${root} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return null;
};

export const list_top_level = async (root: string): Promise<string> => {
  if (!root.trim()) {
    return "";
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true, encoding: "utf8" });
    return entries
      .filter((entry) => !(entry.isDirectory() && ignored_dirs.has(entry.name)))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, max_listing_entries)
      .join("\n");
  } catch (error) {
    console.warn(`[prompts] listing ${root} failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
};

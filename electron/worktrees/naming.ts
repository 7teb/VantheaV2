import path from "node:path";
import { folder_name } from "../project/create.ts";

export const branch_prefix = "vx/";

const slug_runs = 5;

const slug_chars = 40;

const ascii_text = (text: string): string =>
  text
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export const branch_slug = (text: string, id: string): string => {
  const runs: string[] = [];
  const pattern = /[a-z0-9]+/g;
  const ascii = ascii_text(text);
  for (let match = pattern.exec(ascii); match && runs.length < slug_runs; match = pattern.exec(ascii)) {
    runs.push(match[0]);
  }
  const slug = runs.join("-").slice(0, slug_chars).replace(/-+$/, "");
  return slug || `chat-${id.slice(0, 6)}`;
};

const clashes = (name: string, taken: string[]): boolean => {
  const key = name.toLowerCase();
  return taken.some((entry) => entry === key || entry.startsWith(`${key}/`) || key.startsWith(`${entry}/`));
};

export const free_branch = (wanted: string, taken: string[]): string => {
  const keys = taken.map((name) => name.toLowerCase());
  const parent_taken = keys.some((entry) => wanted.toLowerCase().startsWith(`${entry}/`));
  const base = parent_taken ? wanted.replaceAll("/", "-") : wanted;
  for (let index = 1; ; index += 1) {
    const name = index === 1 ? base : `${base}-${index}`;
    if (!clashes(name, keys)) {
      return name;
    }
  }
};

export const worktree_leaf = (top: string): string => folder_name(path.basename(path.resolve(top)));

export const is_branch_name = (name: string): boolean =>
  name.length > 0 &&
  !/[\u0000- \u007f~^:?*[\\]/.test(name) &&
  !name.includes("..") &&
  !name.includes("@{") &&
  !name.includes("//") &&
  name !== "@" &&
  !name.startsWith("-") &&
  !name.startsWith("/") &&
  !name.endsWith("/") &&
  !name.endsWith(".") &&
  name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));

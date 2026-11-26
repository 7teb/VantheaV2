import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const css_block = (text: string, head: string): string => {
  const start = text.indexOf(head);
  assert.ok(start >= 0, head);
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    depth += text[index] === "{" ? 1 : text[index] === "}" ? -1 : 0;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
};

const declarations = (block: string): Record<string, string> => {
  const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    result[match[1]] = match[2].replace(/\s+/g, " ").trim();
  }
  return result;
};

export const tokens = declarations(css_block(read("styles/tokens.css"), ":root {"));

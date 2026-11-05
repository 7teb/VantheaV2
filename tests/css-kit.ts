import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

export const css_block = (text: string, head: string): string => {
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

export const declarations = (block: string): Record<string, string> => {
  const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    result[match[1]] = match[2].replace(/\s+/g, " ").trim();
  }
  return result;
};

export const tokens = declarations(css_block(read("styles/tokens.css"), ":root {"));

export const resolve = (value: string, scope: Record<string, string> = {}): string => {
  const next = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const found = scope[name] ?? tokens[name];
    assert.ok(found !== undefined, name);
    return found;
  });
  return next === value ? value : resolve(next, scope);
};

export const split_top = (value: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === " " && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  return [...parts, current].filter(Boolean);
};

export const px = (value: string, scope: Record<string, string> = {}): number => {
  const resolved = resolve(value, scope);
  const product = /^calc\(\s*(-?[\d.]+)\s*\*\s*(-?[\d.]+)px\s*\)$/.exec(resolved);
  if (product) {
    return Number(product[1]) * Number(product[2]);
  }
  const plain = /^(-?[\d.]+)(px)?$/.exec(resolved);
  assert.ok(plain, `${value} -> ${resolved}`);
  return Number(plain[1]);
};

export type Box = { top: number; right: number; bottom: number; left: number };

export const box = (value: string): Box => {
  const [top, right = top, bottom = top, left = right] = split_top(value).map((part) => px(part));
  return { top, right, bottom, left };
};

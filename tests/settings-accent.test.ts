import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { default_settings, merge_settings, normalize_settings } from "../electron/settings/validate.ts";
import { tokens } from "./css-kit.ts";

const src = fileURLToPath(new URL("../src", import.meta.url));

const source_files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return source_files(full);
    }
    return /\.(css|ts|tsx)$/.test(name) ? [full] : [];
  });

const hue = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h * 60, s, l };
};

const channels = (literal: string): [number, number, number] | null => {
  if (literal.startsWith("#")) {
    const digits = literal.slice(1);
    if (![3, 4, 6, 8].includes(digits.length)) {
      return null;
    }
    const full = digits.length <= 4 ? [...digits.slice(0, 3)].map((digit) => digit + digit).join("") : digits.slice(0, 6);
    return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
  }
  const numbers = literal.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  return numbers && numbers.length === 3 ? (numbers as [number, number, number]) : null;
};

const always_violet = ["--accent-default", "--terminal-magenta", "--terminal-bright-magenta", "--syntax-keyword", "--agent-violet", "--chart-series-1"];

test("no violet color literal is left in the renderer outside the default accent and the fixed palettes", () => {
  const found: string[] = [];
  for (const file of source_files(src)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
          const rgb = channels(match[0]);
          if (!rgb) {
            continue;
          }
          const color = hue(...rgb);
          const violet = color.h >= 235 && color.h <= 315 && color.s >= 0.18 && color.l > 0.08 && color.l < 0.95;
          const allowed = file.endsWith(path.join("styles", "tokens.css")) && always_violet.some((token) => line.trim().startsWith(`${token}:`));
          if (violet && !allowed) {
            found.push(`${path.relative(src, file)}:${index + 1} ${match[0]}`);
          }
        }
      });
  }
  assert.deepEqual(found, []);
});

test("every accent shade derives from --accent, which defaults to --accent-default", () => {
  assert.equal(tokens["--accent"], "var(--accent-default)");
  assert.equal(tokens["--accent-default"], "#a67df2");
  for (const token of ["--surface-accent", "--surface-accent-hover", "--surface-accent-disabled", "--surface-user-bubble", "--brand-accent", "--brand-deep", "--brand-light", "--context-tools"]) {
    assert.ok(tokens[token]?.includes("var(--accent)"), token);
  }
  assert.ok(tokens["--text-on-surface-accent"]?.includes("var(--surface-accent)"));
});

test("the accent color setting keeps a lowercase #rrggbb or the empty default and ignores anything else", () => {
  const base = default_settings();
  assert.equal(base.accent_color, "");
  assert.equal(normalize_settings({ accent_color: "#FF0000" }, base).accent_color, "#ff0000");
  assert.equal(normalize_settings({ accent_color: " #3fb950 " }, base).accent_color, "#3fb950");
  for (const value of ["red", "#fff", "#12345g", "#1234567", 42, null]) {
    assert.equal(normalize_settings({ accent_color: value }, { ...base, accent_color: "#4f8ff7" }).accent_color, "#4f8ff7", String(value));
  }
  const chosen = merge_settings(base, { accent_color: "#e85aad" });
  assert.equal(chosen.accent_color, "#e85aad");
  assert.equal(merge_settings(chosen, { accent_color: "" }).accent_color, "");
  assert.equal(merge_settings(chosen, { language: "de" }).accent_color, "#e85aad");
});

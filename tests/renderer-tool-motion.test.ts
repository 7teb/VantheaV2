import assert from "node:assert/strict";
import { test } from "node:test";
import { css_block, declarations, read } from "./css-kit.ts";

const motion_css = read("features/tools/tool-motion.css");
const tools_css = read("features/tools/tools.css");

test("rows grow from zero height when they join a live group, the row the group grew from does not grow in again", () => {
  const entry = css_block(motion_css, ".work-single[data-live],");
  assert.match(entry, /\.work-single\[data-live\],\s*\.work-group\[data-live\]\s*\{/);
  assert.match(declarations(entry).animation, /^fade-up /);
  const joined_head = ".work-group[data-live] .work-group-body > :is(.tool-row, .thought-row, .notice-row):not(:first-child) {";
  const joined = declarations(css_block(motion_css, joined_head));
  assert.equal(joined.animation, "none");
  assert.match(joined.transition, /^height var\(--duration-slow\) var\(--ease-height\)/);
  const start = declarations(css_block(css_block(motion_css, "@starting-style {"), joined_head));
  assert.equal(start.height, "0");
  assert.equal(start.opacity, "0");
  assert.doesNotMatch(motion_css, /\.work-group-body > \.tool-row\s*[,{]/);
});

test("a single row sits in the same body as a group row without being clipped", () => {
  assert.equal(declarations(css_block(tools_css, ".work-single > .collapsible-body > .collapsible-clip {")).overflow, "visible");
});

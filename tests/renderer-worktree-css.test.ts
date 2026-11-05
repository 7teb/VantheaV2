import assert from "node:assert/strict";
import { test } from "node:test";
import { css_block, declarations, read } from "./css-kit.ts";

const new_css = ["features/composer/ComposerTab.css", "features/docks/files/WorktreeMissing.css", "features/sidebar/WorktreeWarning.css"];

test("the branch sits in the composer strip in caption text, ellipsizes when cut, turns red when its worktree folder is missing, and the title bar keeps only the title", () => {
  const css = read("features/composer/ComposerTab.css");
  const strip = declarations(css_block(css, ".composer-strip {"));
  assert.equal(strip["font-size"], "var(--font-size-caption)");
  assert.equal(strip.color, "var(--text-tertiary)");
  assert.equal(strip["min-width"], "0");
  const item = declarations(css_block(css, ".composer-strip-item {"));
  assert.equal(item["min-width"], "0");
  const name = declarations(css_block(css, ".composer-strip-name {"));
  assert.equal(name.overflow, "hidden");
  assert.equal(name["text-overflow"], "ellipsis");
  assert.equal(name["white-space"], "nowrap");
  const missing = declarations(css_block(css, ".composer-strip-item[data-missing] {"));
  assert.equal(missing.color, "var(--text-danger)");
  const strip_tsx = read("features/composer/ComposerStrip.tsx");
  assert.match(strip_tsx, /<span className="composer-strip-item" data-missing=\{branch\.missing \|\| undefined\}>\s*<GitBranchIcon \/>/);
  assert.doesNotMatch(read("features/shell/Titlebar.tsx"), /TitleBranch|title-branch/);
  assert.doesNotMatch(read("features/shell/Titlebar.css"), /title-branch/);
  const title = declarations(css_block(read("features/shell/Titlebar.css"), ".titlebar-title {"));
  assert.equal(title.display, "flex");
  assert.equal(title["justify-content"], "center");
  const text = declarations(css_block(read("features/shell/Titlebar.css"), ".titlebar-title-text {"));
  assert.equal(text["text-overflow"], "ellipsis");
  assert.equal(text["min-width"], "0");
});

test("a disabled menu row dims its switch the way a disabled toggle does", () => {
  const dimmed = declarations(css_block(read("features/composer/ComposerPopover.css"), ".composer-popover-row:disabled .toggle {"));
  const toggle = declarations(css_block(read("components/Toggle.css"), ".toggle:disabled {"));
  assert.equal(dimmed.opacity, toggle.opacity);
});

test("long worktree paths and messages wrap inside the narrow panel and the dialog instead of overflowing", () => {
  assert.equal(declarations(css_block(read("features/docks/files/WorktreeMissing.css"), ".worktree-missing-path {"))["overflow-wrap"], "anywhere");
  assert.equal(declarations(css_block(read("features/docks/files/WorktreeMissing.css"), ".worktree-missing-error {"))["overflow-wrap"], "anywhere");
  assert.equal(declarations(css_block(read("features/sidebar/WorktreeWarning.css"), ".worktree-warning {"))["overflow-wrap"], "anywhere");
  assert.equal(declarations(css_block(read("components/Tooltip.css"), ".tooltip > span {"))["overflow-wrap"], "anywhere");
  assert.equal(declarations(css_block(read("features/sidebar/WorktreeWarning.css"), '.worktree-warning-line[data-tone="warning"] {')).color, "var(--text-warning)");
});

test("the new worktree styles take every colour from the tokens", () => {
  for (const file of new_css) {
    assert.doesNotMatch(read(file), /#[0-9a-f]{3,8}\b|rgba?\(/i, file);
  }
});

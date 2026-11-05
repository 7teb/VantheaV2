import assert from "node:assert/strict";
import { test } from "node:test";
import { css_block, declarations, read } from "./css-kit.ts";

const scheduled_css = [
  "features/scheduled/ScheduledPage.css",
  "features/scheduled/ScheduledRow.css",
  "features/scheduled/ScheduleDial.css",
  "features/scheduled/RunTrail.css",
  "features/scheduled/ScheduledEmpty.css",
  "features/scheduled/ScheduledDialog.css",
  "features/scheduled/scheduled-sidebar.css",
  "features/chat/ScheduledRun.css",
  "features/tools/approval-facts.css",
  "features/tools/scheduled-approval.css",
];

test("the scheduled task styles take every colour from the tokens", () => {
  for (const file of scheduled_css) {
    assert.doesNotMatch(read(file), /#[0-9a-f]{3,8}\b|rgba?\(/i, file);
  }
});

test("New chat and Scheduled tasks sit as one block at the top of the sidebar", () => {
  assert.equal(declarations(css_block(read("features/sidebar/Sidebar.css"), ".sidebar-nav {")).gap, "2px");
  const sidebar = read("features/sidebar/Sidebar.tsx");
  assert.match(sidebar, /hint=\{shortcut_hint\("new_chat"\)\} on_click=\{\(\) => start_new_chat\(project_path\)\} \/>\s*<ScheduledNav \/>/);
  assert.equal(declarations(css_block(read("features/scheduled/scheduled-sidebar.css"), '.scheduled-nav[aria-current="page"] {')).background, "var(--fill-active)");
});

test("a task card is a raised card with a hairline ring and a footer that runs edge to edge", () => {
  const css = read("features/scheduled/ScheduledRow.css");
  const card = declarations(css_block(css, ".scheduled-card {"));
  assert.equal(card.background, "var(--surface-card)");
  assert.equal(card["box-shadow"], "inset 0 0 0 1px var(--ring-card)");
  assert.equal(card["grid-template-columns"], "40px minmax(0, 1fr) auto");
  const dial = declarations(css_block(read("features/scheduled/ScheduleDial.css"), ".schedule-dial {"));
  assert.equal(dial.width, "40px");
  assert.equal(dial["--dial-length"], "113.1");
  assert.match(read("features/scheduled/ScheduleDial.tsx"), /<ProgressRing [^>]*size=\{40\} \/>/);
  const foot = declarations(css_block(css, ".scheduled-foot {"));
  assert.equal(foot.margin, "12px -14px 0 -16px");
  assert.equal(foot["box-shadow"], "inset 0 1px 0 var(--divider)");
  assert.match(read("features/scheduled/ScheduledRow.tsx"), /className="scheduled-card raised-surface"/);
});

test("the run trail draws quiet runs low and grey, news in the unread violet and failures in red", () => {
  const css = read("features/scheduled/RunTrail.css");
  const mark = declarations(css_block(css, ".run-mark {"));
  assert.equal(mark.height, "6px");
  assert.equal(mark.background, "var(--rule-strong)");
  assert.equal(declarations(css_block(css, '.run-mark[data-result="new"] {')).background, "var(--accent)");
  assert.equal(declarations(css_block(css, '.run-mark[data-result="failed"] {')).background, "var(--text-danger)");
});

test("the schedule control is the large segmented size with a detail line under each label", () => {
  const css = read("components/Segmented.css");
  assert.equal(declarations(css_block(css, '.segmented[data-size="lg"] .segment {')).height, "56px");
  assert.equal(declarations(css_block(css, ".segment-detail {")).color, "var(--text-tertiary)");
  assert.match(read("features/scheduled/ScheduledDialog.tsx"), /size="lg"/);
});

test("quiet runs recede behind a subtler rule than the run divider", () => {
  const css = read("features/chat/ScheduledRun.css");
  assert.equal(declarations(css_block(css, ".run-divider-line::before,")).background, "var(--rule-turn)");
  assert.equal(declarations(css_block(css, ".quiet-run .run-divider-line::before,")).background, "var(--rule-subtle)");
});

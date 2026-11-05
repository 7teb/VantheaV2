import assert from "node:assert/strict";
import { test } from "node:test";
import { box, css_block, declarations, px, read } from "./css-kit.ts";

const menu_css = read("features/composer/ComposerPopover.css");
const composer_tsx = read("features/composer/Composer.tsx");

test("the composer menu is popover glass above the composer at the composer's width", () => {
  const menu = declarations(css_block(menu_css, ".composer-popover {"));
  assert.equal(menu.position, "absolute");
  assert.equal(menu.left, "0");
  assert.equal(menu.right, "0");
  assert.equal(menu.bottom, "calc(100% + var(--space-2))");
  assert.equal(menu.background, "var(--surface-popover)");
  assert.equal(menu["backdrop-filter"], "var(--filter-popover)");
  assert.equal(menu["box-shadow"], "var(--shadow-popover)");
  assert.equal(menu["border-radius"], "var(--radius-2xl)");
  assert.equal(px(menu.padding), 4);
  assert.equal(menu["transform-origin"], "bottom left");
});

test("menu rows follow the item metrics and keep a fixed icon slot", () => {
  const row = declarations(css_block(menu_css, ".composer-popover-row {"));
  const padding = box(row.padding);
  assert.equal(padding.top, 5);
  assert.equal(padding.left, 8);
  assert.equal(row["border-radius"], "var(--radius-item)");
  assert.equal(row.color, "var(--text-row)");
  const icon = declarations(css_block(menu_css, ".composer-popover-icon {"));
  assert.equal(px(icon.width), 16);
  assert.equal(px(icon.height), 16);
  assert.match(read("features/composer/MenuRow.tsx"), /\{Icon && <Icon \/>\}/);
  assert.match(read("components/icons-base.tsx"), /export const Icon = \(\{ size = 16, children, \.\.\.rest \}/);
});

test("cards above the composer slide up by the measured menu height only while a menu is open", () => {
  const rest = declarations(css_block(menu_css, ".composer-slot > :not(.composer) {"));
  assert.equal(rest.transition, "translate var(--duration-slow) var(--ease-out)");
  const lifted = declarations(css_block(menu_css, '.composer-slot:has(> .composer > .composer-popover[data-state="open"]) > :not(.composer) {'));
  assert.equal(lifted.translate, "0 calc(-1 * var(--composer-popover-lift, 0px))");
  assert.match(read("features/composer/ComposerPopover.tsx"), /--composer-popover-lift/);
});

test("only the open menu owns the lift and a closing menu hides behind a newly opened one", () => {
  const popover_tsx = read("features/composer/ComposerPopover.tsx");
  assert.match(popover_tsx, /if \(!open \|\| !node \|\| !slot \|\| !composer\) \{/);
  assert.match(popover_tsx, /if \(!other_open\(slot, node\)\) \{\s*slot\.style\.removeProperty\("--composer-popover-lift"\);/);
  assert.match(popover_tsx, /\}, \[open\]\);/);
  const hidden = declarations(css_block(menu_css, '.composer:has(> .composer-popover[data-state="open"]) > .composer-popover[data-state="closed"] {'));
  assert.equal(hidden.visibility, "hidden");
});

test("switching chats closes the plus menu and drops the note of the previous chat", () => {
  assert.match(composer_tsx, /if \(plus_for !== null && plus_for !== draft_key\) \{\s*set_plus_for\(null\);/);
  assert.match(composer_tsx, /if \(note !== null && note\.key !== draft_key\) \{\s*set_note\(null\);/);
});

test("menu rows sit in menu containers and the input is a combobox for the command list", () => {
  assert.match(composer_tsx, /role="combobox"\s*aria-expanded=\{slash\.open\}\s*aria-autocomplete="list"/);
  assert.match(read("features/composer/PlusMenu.tsx"), /<div role="menu" aria-labelledby=\{`\$\{base\}-add`\}>/);
  assert.match(read("features/composer/PlusSources.tsx"), /<div role="menu" aria-labelledby=\{label_id\}>/);
  assert.match(read("features/composer/SlashMenu.tsx"), /role="listbox"/);
});

test("the plus button replaces the paperclip and the plan chip shows in the bar only while plan mode is on", () => {
  assert.doesNotMatch(composer_tsx, /PaperclipIcon/);
  assert.match(composer_tsx, /<PlusIcon \/>/);
  assert.match(composer_tsx, /\{draft\.plan && \(\s*<button\s+type="button"\s+className="composer-chip draft-chip"\s+data-active\s+data-kind="plan"/);
  assert.match(composer_tsx, /onClick=\{\(\) => toggle_plan\(draft_key\)\}\s*>\s*<span className="draft-chip-icon">\s*<ClipboardListIcon \/>\s*<CloseIcon \/>/);
  assert.doesNotMatch(menu_css, /composer-plan-chip/);
  assert.match(read("features/composer/PlusMenu.tsx"), /checked=\{draft\.plan\}[\s\S]*on_select=\{\(\) => toggle_plan\(draft_key\)\}/);
  assert.match(read("features/composer/command-registry.ts"), /toggled: \(\{ plan \}\) => plan,\s*run: \(\{ draft_key \}\) => toggle_plan\(draft_key\),/);
  assert.match(composer_tsx, /<PlusMenu/);
  assert.match(composer_tsx, /<SlashMenu/);
});

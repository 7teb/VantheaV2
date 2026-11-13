import assert from "node:assert/strict";
import { test } from "node:test";
import { box, css_block, declarations, px, read, resolve, tokens } from "./css-kit.ts";

const base_css = read("styles/base.css");
const slot_css = read("features/composer/ComposerSlot.css");
const todos_css = read("features/composer/TodosPanel.css");
const tab_css = read("features/composer/ComposerTab.css");
const media_css = read("features/composer/ComposerMedia.css");
const ring_css = read("components/ContextRing.css");
const button_css = read("components/Button.css");

type Rgba = { r: number; g: number; b: number; a: number };

const parse_color = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) {
    return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 };
  }
  const functional = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(functional, value);
  const [r, g, b, a = 1] = functional[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { r, g, b, a };
};

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const lightness = (color: Rgba) => {
  const y = 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

const gray = (channel: number): Rgba => ({ r: channel, g: channel, b: channel, a: 1 });

const composer = declarations(css_block(slot_css, ".composer {"));
const input = declarations(css_block(slot_css, ".composer-input {"));
const bar = declarations(css_block(slot_css, ".composer-bar {"));
const main_surface = parse_color(resolve(tokens["--surface-main"]));
const composer_surface = parse_color(resolve(composer.background));

test("the composer is an opaque surface one step above the main surface", () => {
  assert.equal(composer.background, "var(--surface-composer)");
  assert.equal(composer_surface.a, 1);
  assert.deepEqual(main_surface, gray(10));
  const reference_step = lightness(gray(0x2b)) - lightness(gray(0x11));
  const step = lightness(composer_surface) - lightness(main_surface);
  assert.ok(Math.abs(step - reference_step) < 0.5, `step ${step.toFixed(2)} vs ${reference_step.toFixed(2)}`);
});

test("the composer has no backdrop blur and carries the inset hairline instead of the dock shadow", () => {
  assert.equal(composer["backdrop-filter"], undefined);
  assert.equal(composer["box-shadow"], "var(--shadow-composer)");
  assert.equal(tokens["--shadow-composer"], "inset 0 0 1px 0 rgba(255, 255, 255, 0.2)");
  assert.equal(composer["border-radius"], "var(--radius-composer)");
  assert.equal(tokens["--radius-composer"], "22px");
});

test("cards docked above the composer sit opaque one step between the main surface and the composer", () => {
  const cards: [string, string][] = [
    [slot_css, ".composer-dock-card {"],
    [tab_css, ".composer-tab {"],
  ];
  for (const [css, head] of cards) {
    const card = declarations(css_block(css, head));
    assert.equal(card.background, "var(--surface-dock-card)", head);
    assert.equal(card["backdrop-filter"], undefined, head);
  }
  assert.match(read("features/composer/TodosPanel.tsx"), /className="todos-panel composer-dock-card /);
  const todos_panel = declarations(css_block(todos_css, ".todos-panel {"));
  assert.equal(todos_panel.background, undefined);
  assert.equal(todos_panel["backdrop-filter"], undefined);
  const card_surface = parse_color(tokens["--surface-dock-card"]);
  assert.equal(card_surface.a, 1);
  const reference_step = lightness(gray(0x1f)) - lightness(gray(0x11));
  const step = lightness(card_surface) - lightness(main_surface);
  assert.ok(Math.abs(step - reference_step) < 0.5, `step ${step.toFixed(2)} vs ${reference_step.toFixed(2)}`);
  assert.ok(lightness(card_surface) < lightness(composer_surface), "cards below the composer");
});

test("the composer geometry: text at 12px and 14px, a 44px editor and a 28px controls row 8px from the edges", () => {
  const padding = box(composer.padding);
  const inner = box(input.padding);
  assert.equal(padding.left + inner.left, 12);
  assert.equal(padding.right + inner.right, 12);
  assert.equal(padding.top + inner.top, 14);
  assert.equal(px(input["min-height"]), 44);
  assert.equal(padding.left, 8);
  assert.equal(padding.right, 8);
  assert.equal(padding.bottom, 8);
  assert.equal(bar["margin-left"], undefined);
  assert.equal(px(bar["--size-control"]), 28);
  assert.equal(px("var(--size-primary)", bar), 28);
  assert.equal(px(composer.gap), 4);
  assert.equal(padding.top + inner.top + px(input["min-height"]) + px(composer.gap) + px(bar["--size-control"]) + padding.bottom, 98);
});

test("every control in the composer bar takes its height from the scoped 28px size", () => {
  assert.equal(declarations(css_block(slot_css, ".composer-chip {")).height, "var(--size-control)");
  const ring = declarations(css_block(ring_css, ".context-ring {"));
  assert.equal(ring.width, "var(--size-control)");
  assert.equal(ring.height, "var(--size-control)");
  const icon = declarations(css_block(button_css, ".icon-button-md {"));
  assert.equal(icon.height, "var(--size-control)");
  const primary = declarations(css_block(button_css, ".button-primary {"));
  assert.equal(primary.width, "var(--size-primary)");
  assert.equal(primary.height, "var(--size-primary)");
  for (const picker of ["ModelPicker.tsx", "ModePicker.tsx"]) {
    assert.match(read(`features/composer/${picker}`), /<Skeleton width=\{\d+\} height="var\(--size-control\)" radius=\{9\} \/>/, picker);
  }
  const composer_tsx = read("features/composer/Composer.tsx");
  assert.match(read("components/icons-base.tsx"), /export const Icon = \(\{\s*size = 16,/);
  for (const icon_name of ["PlusIcon", "ArrowUpIcon", "StopIcon", "CircleSpinnerIcon"]) {
    assert.match(composer_tsx, new RegExp(`<${icon_name}( className="[^"]*")? />`), icon_name);
    assert.doesNotMatch(composer_tsx, new RegExp(`<${icon_name} size=`), icon_name);
  }
});

test("attachments keep their 12px inset and 6px gap above the text under the new padding", () => {
  const media = declarations(css_block(media_css, ".composer-media {"));
  const padding = box(composer.padding);
  const margin = box(media.margin);
  const inner = box(media.padding);
  assert.equal(padding.left + margin.left, 0);
  assert.equal(padding.right + margin.right, 0);
  assert.equal(padding.left + margin.left + inner.left, 12);
  assert.equal(padding.top + margin.top + inner.top, 12);
  assert.equal(inner.bottom + margin.bottom + px(composer.gap) + box(input.padding).top, 6);
  const feedback = declarations(css_block(slot_css, ".composer-feedback {"));
  assert.equal(padding.left + box(feedback.padding).left, 12);
});

test("the placeholder sits at its level through its own token that no raised surface remaps", () => {
  assert.equal(declarations(css_block(slot_css, ".composer-input::placeholder {")).color, "var(--text-composer-placeholder)");
  assert.equal(tokens["--text-composer-placeholder"], "var(--text-placeholder)");
  const placeholder = parse_color(resolve(tokens["--text-composer-placeholder"]));
  assert.ok(Math.abs(placeholder.a - 0.47 * 0.5) < 1e-9, String(placeholder.a));
  assert.deepEqual({ ...placeholder, a: 1 }, parse_color(tokens["--text-primary"]));
  const raised = declarations(css_block(base_css, ".raised-surface {"));
  assert.equal(raised["--text-composer-placeholder"], undefined);
  assert.ok(placeholder.a < parse_color(resolve(raised["--text-tertiary"])).a, "placeholder darker than the effort label");
});

test("the model picker shows the model name in primary text while the effort stays tertiary", () => {
  const picker = read("features/composer/ModelPicker.tsx");
  assert.match(picker, /<span className="composer-chip-label composer-chip-model">\{model\?\.label \?\? t\("composer\.model_fallback"\)\}<\/span>/);
  assert.match(picker, /<span className="composer-chip-hint" data-effort=\{effort\}>\s*\{effort_label\(t, effort\)\}\s*<\/span>/);
  assert.equal(declarations(css_block(slot_css, '.composer-chip-hint[data-effort="major"] {')).color, "var(--accent)");
  assert.equal(declarations(css_block(slot_css, ".composer-chip-model {")).color, "var(--text-primary)");
  assert.equal(declarations(css_block(slot_css, ".composer-chip-hint {")).color, "var(--text-tertiary)");
  assert.doesNotMatch(read("features/composer/ModePicker.tsx"), /composer-chip-model/);
});

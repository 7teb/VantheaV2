import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { box, css_block, declarations, px, read, resolve } from "./css-kit.ts";

const button_css = read("components/Button.css");
const user_css = read("features/chat/UserMessage.css");
const assistant_css = read("features/chat/AssistantMessage.css");
const slot_css = read("features/composer/ComposerSlot.css");
const icons_tsx = read("components/icons-ui.tsx");
const copy_tsx = read("components/MarkdownCopy.tsx");
const user_tsx = read("features/chat/UserMessage.tsx");
const assistant_tsx = read("features/chat/TurnBody.tsx");
const editor_tsx = read("features/chat/UserEditor.tsx");

const icons_base = read("components/icons-base.tsx");
const view_box = 16;

const action_row = (tsx: string): string => {
  const start = tsx.indexOf('<div className="message-actions');
  assert.ok(start >= 0, "message-actions row");
  return tsx.slice(start, tsx.indexOf("</div>", start));
};

const icon_tags = (markup: string) => [...markup.matchAll(/<(\w+Icon)\b([^>]*)\/>/g)].map((match) => ({ name: match[1], props: match[2] }));

const default_icon_size = () => {
  const match = icons_base.match(/export const Icon = \(\{ size = (\d+), children, \.\.\.rest \}/);
  assert.ok(match, "default icon size");
  return Number(match[1]);
};

const copy_icon_size = () => {
  assert.match(copy_tsx, /const icon = copied \? <CheckIcon \/> : <CopyIcon \/>;/);
  return default_icon_size();
};

const assert_codicon = (name: string) => {
  assert.match(icons_tsx, new RegExp(`export const ${name} = \\(props: IconProps\\) => \\(\\s*<Icon \\{\\.\\.\\.codicon\\} \\{\\.\\.\\.props\\}>`), name);
  assert.match(icons_base, /export const codicon = \{ fill: "currentColor", stroke: "none" \} as const;/);
  assert.match(icons_base, /viewBox="0 0 16 16"/);
};

const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: declarations(`{${match[2]}}`) }));

const arg_counts: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

const path_min_x = (d: string): number => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.\d*|\.\d+|\d+)/g) ?? [];
  let min = Infinity;
  let x = 0;
  let y = 0;
  let start_x = 0;
  let start_y = 0;
  let command = "";
  let index = 0;
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    const lower = command.toLowerCase();
    const relative = command === lower;
    const count = arg_counts[lower];
    assert.ok(count !== undefined, command);
    if (count === 0) {
      x = start_x;
      y = start_y;
      continue;
    }
    const args = tokens.slice(index, index + count).map(Number);
    index += count;
    if (lower === "h") {
      x = relative ? x + args[0] : args[0];
    } else if (lower === "v") {
      y = relative ? y + args[0] : args[0];
    } else {
      x = relative ? x + args[count - 2] : args[count - 2];
      y = relative ? y + args[count - 1] : args[count - 1];
    }
    if (lower === "m") {
      start_x = x;
      start_y = y;
      command = relative ? "l" : "L";
    }
    min = Math.min(min, x);
  }
  return min;
};

const glyph_min_x = (name: string): number => {
  const start = icons_tsx.indexOf(`export const ${name} =`);
  assert.ok(start >= 0, name);
  const body = icons_tsx.slice(start, icons_tsx.indexOf(");", start));
  const paths = [...body.matchAll(/<path[^>]* d="([^"]+)"/g)].map((match) => path_min_x(match[1]));
  const rects = [...body.matchAll(/<rect x="([\d.]+)"/g)].map((match) => Number(match[1]));
  return Math.min(...paths, ...rects);
};

const small_button = declarations(css_block(button_css, ".icon-button-sm {"));

test("the action buttons under both message kinds are 26px buttons with icons in the default 16px box", () => {
  assert.equal(px(small_button.width), 26);
  assert.equal(px(small_button.height), 26);
  for (const [name, tsx] of [["user", user_tsx], ["assistant", assistant_tsx]]) {
    const row = action_row(tsx);
    const buttons = [...row.matchAll(/<IconButton([^>]*)>/g)].map((match) => match[1]);
    assert.ok(buttons.length > 0, name);
    for (const props of buttons) {
      assert.match(props, / size="sm"/, name);
      assert.doesNotMatch(props, /className=/, name);
    }
    const icons = icon_tags(row);
    assert.ok(icons.length > 0, name);
    for (const icon of icons) {
      assert.doesNotMatch(icon.props, /size=/, `${name} ${icon.name}`);
    }
    assert.match(row, /<CopyButton text=\{[\w.]+\}( label=\{t\("chat\.copy_answer"\)\})? \/>/, name);
  }
  assert.equal(copy_icon_size(), 16);
  assert.match(copy_tsx, /<IconButton label=\{[^}]+\} size="sm" onClick=\{copy\}>/);
  assert.equal((px(small_button.width) - copy_icon_size()) % 2, 0, "icon on whole pixels");
});

test("no chat stylesheet resizes the action buttons away from the shared small icon button", () => {
  const chat_dir = new URL("../src/features/chat/", import.meta.url);
  const sheets = readdirSync(chat_dir).filter((file) => file.endsWith(".css"));
  for (const file of sheets) {
    for (const rule of rules(read(`features/chat/${file}`))) {
      if (!rule.selector.includes("message-action") && !rule.selector.includes("assistant-actions")) {
        continue;
      }
      for (const property of ["width", "height", "min-width", "min-height", "padding"]) {
        assert.equal(rule.body[property], undefined, `${file} ${rule.selector} ${property}`);
      }
    }
  }
});

test("the assistant action icons keep their ink at least 3px right of the text edge and sit 5px under the answer's last line", () => {
  const row = declarations(css_block(assistant_css, ".assistant-actions {"));
  const margin = box(row.margin);
  assert.equal(margin.top, 5);
  const icon_left = margin.left + (px(small_button.width) - copy_icon_size()) / 2;
  assert.equal(icon_left, 2);
  for (const glyph of ["CopyIcon", "ForkIcon"]) {
    assert_codicon(glyph);
    const scale = copy_icon_size() / view_box;
    const ink_left = icon_left + glyph_min_x(glyph) * scale;
    assert.ok(ink_left >= 3, `${glyph} ink ${ink_left}`);
  }
  const last_text = declarations(css_block(assistant_css, ".assistant-message > .turn-fold-item:has(+ .assistant-actions) > .turn-fold-clip > .assistant-text:last-child {"));
  assert.equal(last_text["margin-bottom"], "0");
});

test("editing a sent message uses the opaque composer surface, geometry and 28px controls", () => {
  const composer = declarations(css_block(slot_css, ".composer {"));
  const input = declarations(css_block(slot_css, ".composer-input {"));
  const composer_bar = declarations(css_block(slot_css, ".composer-bar {"));
  const editor = declarations(css_block(user_css, ".user-editor {"));
  const area = declarations(css_block(user_css, ".user-editor textarea {"));
  const bar = declarations(css_block(user_css, ".user-editor-bar {"));
  assert.equal(editor.background, "var(--surface-composer)");
  assert.equal(editor.background, composer.background);
  assert.equal(editor["box-shadow"], composer["box-shadow"]);
  assert.equal(editor["border-radius"], "var(--radius-composer)");
  assert.equal(editor["border-radius"], composer["border-radius"]);
  assert.equal(editor["backdrop-filter"], undefined);
  assert.notEqual(resolve(editor.background), resolve("var(--surface-dock)"));
  assert.deepEqual(box(editor.padding), box(composer.padding));
  assert.equal(px(editor.gap), px(composer.gap));
  assert.deepEqual(box(area.padding), box(input.padding));
  assert.equal(px(area["min-height"]), px(input["min-height"]));
  assert.equal(area["font-size"], input["font-size"]);
  assert.equal(area["line-height"], input["line-height"]);
  const outer = box(editor.padding);
  const inner = box(area.padding);
  assert.equal(outer.left + inner.left, 12);
  assert.equal(outer.top + inner.top, 14);
  assert.equal(outer.bottom, 8);
  assert.equal(outer.right, 8);
  assert.equal(bar["--size-control"], composer_bar["--size-control"]);
  assert.equal(px(bar["--size-control"]), 28);
  assert.equal(px(declarations(css_block(button_css, ".button {")).height, bar), 28);
  assert.match(editor_tsx, /<div className="user-editor raised-surface">/);
});

test("the composer radius and control height have one source each in the tokens", () => {
  for (const file of ["features/composer/ComposerSlot.css", "features/composer/QueuedList.css", "features/chat/UserMessage.css"]) {
    assert.doesNotMatch(read(file), /--composer-radius/, file);
  }
  assert.equal(px("var(--radius-composer)"), 22);
  assert.equal(px("var(--size-control-composer)"), 28);
  assert.equal(declarations(css_block(slot_css, ".composer-bar {"))["--size-control"], "var(--size-control-composer)");
  assert.equal(declarations(css_block(slot_css, ".composer-slot {"))["--radius-composer"], undefined);
});

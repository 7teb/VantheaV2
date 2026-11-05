import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { css_block, declarations, read } from "./css-kit.ts";
import { bundle } from "./dom-kit.ts";

const layout_queries = {
  phone: "(max-width: 600px)",
  drawer: "(max-width: 860px)",
  short: "(max-height: 500px)",
  touch: "(hover: none) and (pointer: coarse)",
  fine_pointer: "(any-pointer: fine)",
};

const existing_queries = ["(prefers-reduced-motion: reduce)", "(max-width: 620px)", "(max-width: 720px)", "(hover: hover)", "(hover: hover) and (pointer: fine) and (min-width: 601px)", "(min-width: 861px)"];

const src_root = fileURLToPath(new URL("../src/", import.meta.url));

const css_files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return css_files(full);
    }
    return name.endsWith(".css") ? [full] : [];
  });

const sheets = css_files(src_root).map((file) => ({ file, text: readFileSync(file, "utf8") }));

const media_queries = (text: string) => [...text.matchAll(/@media\s+([^{]+)\{/g)].map((match) => match[1].replace(/\s+/g, " ").trim());

const fake_window = (matching: string[]) => ({
  innerWidth: 390,
  innerHeight: 844,
  matchMedia: (query: string) => ({ matches: matching.includes(query), addEventListener: () => {} }),
});

const with_ui = async (scenario: string, matching: string[], body: (ui: Record<string, any>) => void) => {
  const saved = ["window", "localStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(globalThis, "window", { configurable: true, value: fake_window(matching) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  try {
    const ui = await bundle(
      [`export const scenario = ${JSON.stringify(scenario)};`, 'export * from "./src/state/ui.ts";', 'export { layout_queries, layout_store } from "./src/state/layout.ts";'],
      [],
    );
    body(ui);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
};

test("the layout store reads the same query strings the stylesheets repeat", async () => {
  await with_ui("queries", [], (ui) => assert.deepEqual(ui.layout_queries, layout_queries));
  const all = sheets.map((sheet) => sheet.text).join("\n");
  for (const name of ["phone", "drawer", "short", "touch"] as const) {
    assert.ok(all.includes(`@media ${layout_queries[name]}`), name);
  }
});

test("every media query in the renderer is a layout query or one of the listed existing rules", () => {
  const allowed = new Set([layout_queries.phone, layout_queries.drawer, layout_queries.short, layout_queries.touch, ...existing_queries]);
  for (const { file, text } of sheets) {
    for (const query of media_queries(text)) {
      assert.ok(allowed.has(query), `${path.basename(file)}: @media ${query}`);
    }
  }
});

test("a phone starts with the chat list closed and every choice in the drawer closes it again", async () => {
  await with_ui("phone", [layout_queries.phone, layout_queries.drawer, layout_queries.touch], (ui) => {
    assert.equal(ui.layout_store.get().drawer, true);
    assert.equal(ui.ui_store.get().sidebar_collapsed, true);
    const choices: [string, () => void][] = [
      ["open_chat", () => ui.open_chat("c1", "")],
      ["start_new_chat", () => ui.start_new_chat("")],
      ["open_settings", () => ui.open_settings()],
      ["open_search", () => ui.open_search()],
    ];
    for (const [name, choose] of choices) {
      ui.set_sidebar_collapsed(false);
      choose();
      assert.equal(ui.ui_store.get().sidebar_collapsed, true, name);
    }
  });
});

test("a desktop window keeps the sidebar open after the same choices", async () => {
  await with_ui("desktop", [], (ui) => {
    assert.equal(ui.ui_store.get().sidebar_collapsed, false);
    ui.open_chat("c1", "");
    ui.start_new_chat("");
    ui.open_settings();
    ui.open_search();
    assert.equal(ui.ui_store.get().sidebar_collapsed, false);
  });
});

test("touch screens get 40px controls, 44px rows and title bar, and safe-area tokens from env()", () => {
  const tokens_css = read("styles/tokens.css");
  const desktop = declarations(css_block(tokens_css, ":root {"));
  assert.equal(desktop["--size-control"], "32px");
  assert.equal(desktop["--size-titlebar"], "40px");
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.equal(desktop[`--safe-${side}`], `env(safe-area-inset-${side}, 0px)`, side);
  }
  const touch = declarations(css_block(css_block(tokens_css, `@media ${layout_queries.touch} {`), ":root {"));
  assert.deepEqual(touch, {
    "--size-control": "40px",
    "--size-control-composer": "36px",
    "--size-row": "44px",
    "--size-field": "44px",
    "--size-titlebar": "44px",
  });
  const phone = declarations(css_block(css_block(tokens_css, `@media ${layout_queries.phone} {`), ":root {"));
  assert.deepEqual(phone, { "--font-size-hero": "40px" });
});

test("inputs on touch screens stay at 16px so iOS does not zoom on focus", () => {
  const touch = css_block(read("styles/base.css"), `@media ${layout_queries.touch} {`);
  const fields = declarations(css_block(touch, "select {"));
  assert.equal(fields["font-size"], "max(16px, 1em) !important");
  assert.match(touch, /input,\s*textarea,\s*select \{/);
});

test("the page covers the notch and the keyboard resizes the content", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" \/>/);
  assert.match(html, /<meta name="format-detection" content="telephone=no, date=no, email=no, address=no" \/>/);
  const shell = declarations(css_block(css_block(read("features/shell/Shell.css"), `@media ${layout_queries.touch} {`), ".shell {"));
  assert.equal(shell.position, "fixed");
  assert.equal(shell.top, "var(--viewport-top, 0px)");
  assert.equal(shell.height, "var(--viewport-height, 100dvh)");
});

test("no stylesheet outside the tokens writes a colour literal", () => {
  for (const { file, text } of sheets) {
    if (file.endsWith(path.join("styles", "tokens.css"))) {
      continue;
    }
    assert.doesNotMatch(text, /#[0-9a-f]{3,8}\b|rgba?\(/i, path.basename(file));
  }
});

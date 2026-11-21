import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import type { Tool, ToolProfile } from "../electron/tools/types.ts";
import { tool_model } from "./tool-model.ts";

const electron_stub = "module.exports = { app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() } };";

const bundle_url = pathToFileURL(path.join(process.cwd(), "tests", "registry-headless.bundle.js")).href;

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: electron_stub, loader: "js" }));
  },
};

let main: {
  tools_for: (profile: ToolProfile, settings: unknown, model: typeof tool_model) => Tool[];
  find_tool: (name: string) => Tool | null;
  default_settings: () => unknown;
  set_headless: () => void;
  computer_tools: Tool[];
  scheduled_tools: Tool[];
  browser_tools: Tool[];
};

before(async () => {
  const entry = [
    'export { tools_for, find_tool } from "./electron/tools/registry.ts";',
    'export { default_settings } from "./electron/settings/validate.ts";',
    'export { set_headless } from "./electron/app/runtime.ts";',
    'export { computer_tools } from "./electron/tools/computer/index.ts";',
    'export { scheduled_tools } from "./electron/tools/scheduled/index.ts";',
    'export { browser_tools } from "./electron/tools/browser/index.ts";',
  ].join("\n");
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [main_stubs],
    define: { "import.meta.url": JSON.stringify(bundle_url) },
    banner: { js: `import { createRequire as bundle_require } from "node:module"; const require = bundle_require(${JSON.stringify(bundle_url)});` },
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

const vision_model = { ...tool_model, vision: true };

const offered = () => new Set(main.tools_for("main", main.default_settings(), vision_model).map((tool) => tool.spec.name));

const names = (tools: Tool[]) => tools.map((tool) => tool.spec.name);

test("the registry offers computer and scheduled tools in the desktop app and hides them once the runtime is headless", () => {
  const hidden = [...names(main.computer_tools), ...names(main.scheduled_tools)];
  const desktop = offered();
  const browser = names(main.browser_tools).filter((name) => desktop.has(name));
  assert.ok(hidden.length > 0);
  assert.ok(browser.length > 0);

  for (const name of [...hidden, ...browser]) {
    assert.equal(desktop.has(name), true, `${name} is offered in the desktop app`);
    assert.ok(main.find_tool(name), `${name} is found in the desktop app`);
  }

  main.set_headless();

  const headless = offered();
  for (const name of hidden) {
    assert.equal(headless.has(name), false, `${name} is hidden in headless`);
    assert.equal(main.find_tool(name), null, `${name} is not found in headless`);
  }
  for (const name of browser) {
    assert.equal(headless.has(name), true, `${name} stays offered in headless`);
    assert.ok(main.find_tool(name), `${name} is still found in headless`);
  }
  assert.deepEqual([...desktop].filter((name) => !hidden.includes(name)), [...headless]);
});

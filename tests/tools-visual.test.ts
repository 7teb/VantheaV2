import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { visual_result_text, visualize_tool } from "../electron/tools/visual/index.ts";
import { ToolArgumentError, type Tool, type ToolContext, type ToolProfile } from "../electron/tools/types.ts";
import { visual_tool_name, visual_vars } from "../shared/visual.ts";
import { tool_model } from "./tool-model.ts";

const ctx = { signal: new AbortController().signal } as ToolContext;

const electron_stub = "module.exports = { app: { getAppPath: () => process.cwd(), getPath: () => process.cwd() } };";

const bundle_url = pathToFileURL(path.join(process.cwd(), "tests", "tools-visual.bundle.js")).href;

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: electron_stub, loader: "js" }));
  },
};

let main: { tools_for: (profile: ToolProfile, settings: unknown, model: typeof tool_model) => Tool[]; default_settings: () => unknown };

before(async () => {
  const entry = ['export { tools_for } from "./electron/tools/registry.ts";', 'export { default_settings } from "./electron/settings/validate.ts";'].join("\n");
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

const offered = (profile: ToolProfile) => main.tools_for(profile, main.default_settings(), tool_model).some((tool) => tool.spec.name === visual_tool_name);

test("visualize is offered to the main agent and plan mode, never to sub-agents", () => {
  assert.equal(offered("main"), true);
  assert.equal(offered("plan"), true);
  assert.equal(offered("explore"), false);
  assert.equal(offered("worker"), false);
  assert.equal(main.tools_for("main", main.default_settings(), { ...tool_model, vision: true }).some((tool) => tool.spec.name === visual_tool_name), true);
});

test("visualize shows the exact code with the title as a visual view", async () => {
  const code = '<div class="chain">\n  <span>0x7ff6</span>\n</div>\n<script>document.querySelector(".chain").dataset.step = "1";</script>\n';
  const result = await visualize_tool.execute(ctx, { title: "  Zeiger\n kette  ", code });
  assert.equal(result.status, "done");
  assert.equal(result.text, visual_result_text);
  assert.deepEqual(result.view, { kind: "visual", title: "Zeiger kette", code });
});

test("visualize rejects a missing or empty title or code with an actionable message", async () => {
  const rejects = (raw: Record<string, unknown>, key: "title" | "code") =>
    assert.rejects(
      async () => visualize_tool.execute(ctx, raw),
      (error: unknown) => error instanceof ToolArgumentError && error.message.startsWith(`${key} must be a non-empty string: `) && error.message.endsWith(`call visualize again with ${key} filled in.`),
    );
  await rejects({ code: "<p>x</p>" }, "title");
  await rejects({ title: "", code: "<p>x</p>" }, "title");
  await rejects({ title: " \n ", code: "<p>x</p>" }, "title");
  await rejects({ title: 3, code: "<p>x</p>" }, "title");
  await rejects({ title: "Chart" }, "code");
  await rejects({ title: "Chart", code: "" }, "code");
  await rejects({ title: "Chart", code: "  \n\t" }, "code");
  await rejects({ title: "Chart", code: ["<p>x</p>"] }, "code");
});

test("the visualize description lists every injected variable with its use", () => {
  const { description, parameters } = visualize_tool.spec;
  for (const entry of visual_vars) {
    assert.ok(description.includes(`${entry.name}: ${entry.use}`), `${entry.name} is missing from the description`);
  }
  assert.deepEqual(parameters.required, ["title", "code"]);
  assert.deepEqual(visualize_tool.profiles, ["main", "plan"]);
});

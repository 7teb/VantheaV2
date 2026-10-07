import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const require_shim = 'import { createRequire as vx_create_require } from "node:module"; const require = vx_create_require(import.meta.url);';

const targets = [
  {
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
    format: "esm",
    external: ["electron", "node-pty", "@modelcontextprotocol/sdk"],
    banner: { js: require_shim },
  },
  {
    entryPoints: ["electron/preload.ts"],
    outfile: "dist-electron/preload.cjs",
    format: "cjs",
    external: ["electron"],
  },
];

const options = (target) => ({
  ...target,
  bundle: true,
  platform: "node",
  target: "node22",
  logLevel: "info",
  legalComments: "none",
});

if (watch) {
  for (const target of targets) {
    const ctx = await context(options(target));
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((target) => build(options(target))));
}

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const out_dir = "dist-sdk";

const targets = [
  { entryPoints: ["sdk/index.ts"], outfile: `${out_dir}/index.js` },
  { entryPoints: ["sdk/cli.ts"], outfile: `${out_dir}/cli.js`, banner: { js: "#!/usr/bin/env node" } },
];

const options = (target) => ({
  ...target,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "info",
  legalComments: "none",
});

const declaration_args = [
  path.join("node_modules", "typescript", "bin", "tsc"),
  "--ignoreConfig",
  "sdk/index.ts",
  "--declaration",
  "--emitDeclarationOnly",
  "--outDir",
  `${out_dir}/types`,
  "--rootDir",
  ".",
  "--target",
  "ES2023",
  "--lib",
  "ES2023",
  "--module",
  "ESNext",
  "--moduleResolution",
  "bundler",
  "--moduleDetection",
  "force",
  "--allowImportingTsExtensions",
  "--verbatimModuleSyntax",
  "--strict",
  "--skipLibCheck",
  "--types",
  "node",
];

await fs.rm(out_dir, { recursive: true, force: true });
await Promise.all(targets.map((target) => build(options(target))));

const declarations = spawnSync(process.execPath, declaration_args, { stdio: "inherit" });
if (declarations.status !== 0) {
  throw new Error(`declaration emit failed with exit code ${declarations.status ?? declarations.signal}`);
}

await fs.copyFile("sdk/package.json", `${out_dir}/package.json`);
console.log(`[build-sdk] ${out_dir}/index.js, ${out_dir}/cli.js, ${out_dir}/types and ${out_dir}/package.json are ready`);

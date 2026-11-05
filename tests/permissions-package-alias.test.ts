import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { package_call } from "../electron/permissions/package-calls.ts";
import { resolved } from "../electron/permissions/command-walk.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { sent_text } from "./sources-fixture.ts";

const variants: [string, string][] = [
  ...["install-ci", "install-ci-", "install-ci-t", "install-ci-te", "install-ci-tes", "clean-install-", "clean-install-t", "clean-install-te", "clean-install-tes", "si", "installCiTest", "cleanInstallTest"].map((word): [string, string] => [word, "install-ci-test"]),
  ...["install-t", "install-te", "install-tes", "installTest"].map((word): [string, string] => [word, "install-test"]),
  ...["res", "rest", "resta", "restar"].map((word): [string, string] => [word, "restart"]),
  ["sto", "stop"], ["ts", "test"], ["run-", "run"], ["ur", "run"], ["runScript", "run"],
  ...["install-cl", "install-cle", "install-clea", "isntall-", "isntall-c", "isntall-cl", "isntall-cle", "isntall-clea", "isntallClean"].map((word): [string, string] => [word, "ci"]),
];

const args = (words: string[]) => words.map((word) => ({ written: word, value: resolved([word]) }));

for (const [word, canonical] of variants) test(`npm CLI alias ${word} inspects its ${canonical} script`, () => {
  const found = package_call(args([word, ...(canonical === "run" ? ["lint"] : [])]), "npm");
  const lifecycle = ["install", "ci", "install-test", "install-ci-test"].includes(canonical);
  assert.equal(found.call?.name, canonical === "run" ? "lint" : lifecycle ? "install" : canonical);
  assert.equal(found.call?.lifecycle, lifecycle);
  if (canonical.endsWith("-test")) assert.equal(found.call?.test, true);
});

for (const alias of ["t", "tst"]) test(`pnpm shorthand ${alias} uses the test script`, () => {
  assert.equal(package_call(args([alias]), "pnpm").call?.name, "test");
  assert.equal(package_call(args(["run", alias]), "pnpm").call?.name, alias);
  assert.equal(package_call(args([alias.toUpperCase()]), "pnpm").call?.name, alias.toUpperCase());
});

test("ambiguous npm prefixes stay unclassified instead of becoming a different command", () => {
  for (const word of ["ru", "sta", "re"]) assert.equal(package_call(args([word, "lint"]), "npm").call, null, word);
});

test("script-source inspection reaches abbreviated npm and pnpm commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-package-alias-"));
  try {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: Object.fromEntries(["lint", "test", "stop", "restart"].map((name) => [name, "node marker.js"])) }));
    await fs.writeFile(path.join(root, "marker.js"), "console.log('reviewed-package-alias-marker')");
    for (const command of ["npm run- lint", "npm ur lint", "npm sto", "npm ts", "npm rest", "npm runScript lint", "pnpm t", "pnpm tst"]) assert.match(sent_text(await inspect_command_sources(root, root, command)), /reviewed-package-alias-marker/, command);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("installed npm and pnpm really execute the abbreviated local marker scripts", { skip: process.platform !== "win32" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-package-cli-"));
  try {
    const npm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const pnpm = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "pnpm", "bin", "pnpm.cjs");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "local-alias-marker", private: true, scripts: Object.fromEntries(["lint", "test", "stop", "restart"].map((name) => [name, "node marker.js"])) }));
    await fs.writeFile(path.join(root, "marker.js"), "console.log('native-package-alias-marker')");
    for (const [cli, words] of [[npm, ["run-", "lint"]], [npm, ["sto"]], [npm, ["ts"]], [npm, ["ur", "lint"]], [npm, ["rest"]], [npm, ["runScript", "lint"]], [pnpm, ["t"]], [pnpm, ["tst"]]] as const) {
      if (!(await fs.stat(cli).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; }))) continue;
      const native = spawnSync(process.execPath, [cli, ...words], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 10000, env: { ...process.env, COREPACK_ENABLE_NETWORK: "0", npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" } });
      assert.equal(native.status, 0, words.join(" ") + native.stderr);
      assert.match(native.stdout, /native-package-alias-marker/, words.join(" "));
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

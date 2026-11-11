import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const main_switches = async (): Promise<[string, string][]> => {
  const source = await fs.readFile(path.resolve("electron/main.ts"), "utf8");
  return [...source.matchAll(/app\.commandLine\.appendSwitch\("([^"]+)"(?:, "([^"]+)")?\)/g)].map((match) => [match[1] ?? "", match[2] ?? ""]);
};

const main_script = (switches: [string, string][]): string => `
const { app, WebContentsView } = require("electron");
const path = require("node:path");
const { create_surface, default_tab_size, guest_preferences } = require("./surface.cjs");
for (const [name, value] of ${JSON.stringify(switches)}) {
  if (value) app.commandLine.appendSwitch(name, value);
  else app.commandLine.appendSwitch(name);
}
app.setPath("userData", path.join(__dirname, "profile"));
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))]);
app.whenReady().then(async () => {
  try {
    const surface = create_surface(default_tab_size);
    const view = new WebContentsView({ webPreferences: guest_preferences("vx-surface-probe") });
    surface.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, ...default_tab_size });
    surface.showInactive();
    await view.webContents.loadURL("data:text/html,<button>go</button>");
    const frame = await within(view.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve('frame'))))"), 5000);
    console.log("VX_RESULT " + JSON.stringify({ frame }));
    surface.destroy();
    app.quit();
  } catch (error) {
    console.error(String(error));
    app.exit(1);
  }
});`;

test("a background browser tab keeps drawing frames in its hidden offscreen window", { skip: process.platform !== "win32", timeout: 40000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-surface-"));
  try {
    await fs.mkdir(path.join(dir, "profile"));
    await build({
      stdin: {
        contents: [
          'export { create_surface, default_tab_size } from "./electron/browser/surface.ts";',
          'export { guest_preferences } from "./electron/browser/guest-security.ts";',
        ].join("\n"),
        resolveDir: process.cwd(),
        loader: "ts",
      },
      outfile: path.join(dir, "surface.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "silent",
    });
    await fs.writeFile(path.join(dir, "main.cjs"), main_script(await main_switches()));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(path.resolve("node_modules/electron/dist/electron.exe"), [path.join(dir, "main.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const timer = setTimeout(() => child.kill(), 30000);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    clearTimeout(timer);
    assert.equal(code, 0, errors.slice(-1000));
    const line = output.split(/\r?\n/).find((entry) => entry.startsWith("VX_RESULT "));
    assert.ok(line, errors.slice(-1000));
    assert.deepEqual(JSON.parse(line.slice("VX_RESULT ".length)), { frame: "frame" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

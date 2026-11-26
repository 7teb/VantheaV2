import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const page = `<!doctype html>
<p id="out">hello</p>
<input id="field" value="typed">
<div id="host"></div>
<script>
window.page_state = 3;
document.getElementById("out").expando = "set by the page";
</script>`;

const expressions = {
  page_global: "window.page_state",
  expando: "document.getElementById('out').expando",
  text_write: "document.getElementById('out').textContent = 'changed'",
  text_after: "document.getElementById('out').textContent",
  resources: "Array.isArray(performance.getEntriesByType('resource'))",
  dom_write: "document.body.appendChild(document.createElement('div')).nodeName",
  threw: "null.x",
};

const page_probe = "[document.querySelector('#out').textContent, document.body.children.length].join('|')";

const main_script = (page_url: string): string => `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { evaluate_expression } = require("./evaluate.cjs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL(${JSON.stringify(page_url)});
    const tab = { tab_id: "probe", guest: win.webContents, debugger_attached: false };
    const results = {};
    for (const [name, expression] of Object.entries(${JSON.stringify(expressions)})) {
      results[name] = await evaluate_expression(tab, expression, new AbortController().signal);
    }
    results.page = await win.webContents.executeJavaScript(${JSON.stringify(page_probe)});
    console.log("VX_RESULT " + JSON.stringify(results));
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(String(error));
    app.exit(1);
  }
});`;

test("browser_eval runs reads, writes, page globals and Web APIs in the page's own context", { skip: process.platform !== "win32", timeout: 40000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-eval-native-"));
  try {
    await fs.mkdir(path.join(dir, "profile"));
    await build({
      entryPoints: [path.resolve("electron/browser/evaluate.ts")],
      outfile: path.join(dir, "evaluate.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "silent",
    });
    await fs.writeFile(path.join(dir, "main.cjs"), main_script(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`));
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
    const results = JSON.parse(line.slice("VX_RESULT ".length));
    assert.deepEqual(results.page_global, { thrown: false, kind: "number", text: "3" });
    assert.deepEqual(results.expando, { thrown: false, kind: "string", text: "set by the page" });
    assert.deepEqual(results.text_write, { thrown: false, kind: "string", text: "changed" });
    assert.deepEqual(results.text_after, { thrown: false, kind: "string", text: "changed" });
    assert.deepEqual(results.resources, { thrown: false, kind: "boolean", text: "true" });
    assert.deepEqual(results.dom_write, { thrown: false, kind: "string", text: "DIV" });
    assert.equal(results.threw.thrown, true);
    assert.equal(results.threw.kind, "threw");
    assert.equal(results.page, "changed|5");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

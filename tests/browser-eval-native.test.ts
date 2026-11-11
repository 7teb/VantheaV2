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
document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<span id="inner">shadow</span>';
</script>`;

const expressions = {
  by_id_text: "document.getElementById('out').textContent",
  by_id_value: "document.getElementById('field').value",
  by_id_missing: "document.getElementById('missing')",
  by_id_empty: "document.getElementById('')",
  by_id_shadow: "document.getElementById('host').shadowRoot.getElementById('inner').textContent",
  by_id_expando: "document.getElementById('out').expando",
  by_id_text_write: "document.getElementById('out').textContent = 'changed'",
  by_id_value_write: "document.getElementById('field').value = 'changed'",
  by_id_remove: "document.getElementById('out').remove()",
  query_text: "document.querySelector('#out').textContent",
  page_global: "window.page_state",
  dom_write: "document.body.appendChild(document.createElement('div'))",
};

const main_world_probe =
  "[document.getElementById.toString().includes('[native code]'), DocumentFragment.prototype.getElementById.toString().includes('[native code]'), document.querySelector('#out').textContent, document.querySelector('#field').value, document.body.children.length].join('|')";

const main_script = (page_url: string): string => `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { evaluate_safely } = require("./evaluate.cjs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadURL(${JSON.stringify(page_url)});
    const tab = { tab_id: "probe", guest: win.webContents, debugger_attached: false };
    const results = {};
    for (const [name, expression] of Object.entries(${JSON.stringify(expressions)})) {
      results[name] = await evaluate_safely(tab, expression, new AbortController().signal);
    }
    results.main_world = await win.webContents.executeJavaScript(${JSON.stringify(main_world_probe)});
    console.log("VX_RESULT " + JSON.stringify(results));
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(String(error));
    app.exit(1);
  }
});`;

test("browser_eval runs getElementById reads in an isolated world, refuses writes and leaves the page and its own world untouched", { skip: process.platform !== "win32", timeout: 40000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-eval-world-"));
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
    assert.deepEqual(results.by_id_text, { thrown: false, kind: "string", text: "hello", isolated: true });
    assert.deepEqual(results.by_id_value, { thrown: false, kind: "string", text: "typed", isolated: true });
    assert.deepEqual(results.by_id_missing, { thrown: false, kind: "null", text: "null", isolated: true });
    assert.deepEqual(results.by_id_empty, { thrown: false, kind: "null", text: "null", isolated: true });
    assert.deepEqual(results.by_id_shadow, { thrown: false, kind: "string", text: "shadow", isolated: true });
    assert.deepEqual(results.by_id_expando, { thrown: false, kind: "undefined", text: "undefined", isolated: true });
    for (const name of ["by_id_text_write", "by_id_value_write", "by_id_remove", "dom_write"]) {
      assert.equal(results[name].kind, "side effect", name);
      assert.equal(results[name].isolated, false, name);
    }

    assert.deepEqual(results.query_text, { thrown: false, kind: "string", text: "hello", isolated: false });
    assert.deepEqual(results.page_global, { thrown: false, kind: "number", text: "3", isolated: false });
    assert.equal(results.main_world, "true|true|hello|typed|4");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

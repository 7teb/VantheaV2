import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, crc32 } from "node:zlib";
import { test } from "node:test";
import { build } from "esbuild";

const png_chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const pixel_png = (): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, png_chunk("IHDR", header), png_chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), png_chunk("IEND", Buffer.alloc(0))]);
};

const probe_page = (outside_text: string, outside_image: string, outside_page: string): string => `<!doctype html>
<script>
const read = async (url) => {
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : "status " + response.status;
  } catch {
    return "blocked";
  }
};
const image = (url) => new Promise((resolve) => {
  const element = new Image();
  element.onload = () => resolve("loaded");
  element.onerror = () => resolve("blocked");
  element.src = url;
});
const frame = (url) => new Promise((resolve) => {
  const element = document.createElement("iframe");
  element.onload = () => {
    try {
      resolve(element.contentDocument?.body?.textContent?.includes("outside page") ? "read" : "blocked");
    } catch {
      resolve("blocked");
    }
  };
  element.src = url;
  document.body.append(element);
  setTimeout(() => resolve("blocked"), 3000);
});
window.probe = async () => ({
  outside_fetch: await read(${JSON.stringify(outside_text)}),
  inside_fetch: await read("./data.txt"),
  outside_image: await image(${JSON.stringify(outside_image)}),
  inside_image: await image("./pixel.png"),
  outside_frame: await frame(${JSON.stringify(outside_page)}),
});
</script>
<body></body>`;

const main_script = (page_url: string): string => `
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const { secure_session, guest_preferences } = require("./guest.cjs");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const partition = "vx-local-files-probe";
  secure_session(session.fromPartition(partition));
  const win = new BrowserWindow({ show: false, webPreferences: guest_preferences(partition) });
  try {
    await win.loadURL(${JSON.stringify(page_url)});
    const data = await win.webContents.executeJavaScript("window.probe()");
    console.log("VX_RESULT " + JSON.stringify(data));
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(String(error));
    app.exit(1);
  }
});`;

test("a local page reads and shows files only from its own folder", { skip: process.platform !== "win32", timeout: 40000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-local-files-"));
  try {
    const site = path.join(dir, "site");
    const outside = path.join(dir, "outside");
    await fs.mkdir(site);
    await fs.mkdir(outside);
    await fs.mkdir(path.join(dir, "profile"));
    await fs.writeFile(path.join(site, "data.txt"), "inside text");
    await fs.writeFile(path.join(site, "pixel.png"), pixel_png());
    await fs.writeFile(path.join(outside, "secret.txt"), "outside text");
    await fs.writeFile(path.join(outside, "pixel.png"), pixel_png());
    await fs.writeFile(path.join(outside, "page.html"), "<body>outside page</body>");
    const outside_url = (name: string) => pathToFileURL(path.join(outside, name)).href;
    await fs.writeFile(path.join(site, "index.html"), probe_page(outside_url("secret.txt"), outside_url("pixel.png"), outside_url("page.html")));
    await build({
      entryPoints: [path.resolve("electron/browser/guest-security.ts")],
      outfile: path.join(dir, "guest.cjs"),
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      logLevel: "silent",
    });
    await fs.writeFile(path.join(dir, "main.cjs"), main_script(pathToFileURL(path.join(site, "index.html")).href));
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
    assert.deepEqual(JSON.parse(line.slice("VX_RESULT ".length)), {
      outside_fetch: "blocked",
      inside_fetch: "blocked",
      outside_image: "blocked",
      inside_image: "loaded",
      outside_frame: "blocked",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

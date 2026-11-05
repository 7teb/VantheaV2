import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { page_facts } from "../electron/check/facts.ts";
import { control_box, scroll_to_control } from "../electron/check/page-scripts.ts";

let root = "";
let vision: any;
let live: any;
const fixture = { window: null as any, viewport: null as any };
const stubs: Record<string, string> = {
  "input.ts": 'export const viewport=(...args)=>globalThis.browser_check_fixture.viewport(...args); export const click_point=async()=>{};',
  "cdp.ts": 'export const cdp=async()=>({});export const ensure_debugger=async()=>{};export const read_frames=async()=>new Map();export const frame_session=()=>"";',
  "refs.ts": 'export const sweep_stores=()=>{};',
  "target.ts": 'export const describe=()=>"";export const live_node=async()=>({});',
  "model-image.ts": 'export const model_jpeg=()=>Buffer.from("jpeg");',
  "transport.ts": 'export const abortable_sleep=async()=>{};',
  "serve.ts": 'export const serve_folder=()=>{};export const stop_serving=()=>{};',
  "session.ts": 'export const check_session=()=>({clearStorageData:async()=>{},clearCache:async()=>{}});export const listen_blocked=()=>{};',
  "window.ts": 'export class CheckFailure extends Error{};export const open_check_window=()=>globalThis.browser_check_fixture.window;export const capture_frame=async()=>({toPNG:()=>Buffer.from("png")});',
};
const plugin: Plugin = { name: "browser-check-stub", setup(api) {
  api.onResolve({ filter: /[\\/](?:input|cdp|refs|target|model-image|transport|serve|session|window)\.ts$/ }, (args) => ({ path: path.basename(args.path), namespace: "check-stub" }));
  api.onLoad({ filter: /.*/, namespace: "check-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
} };
const bundle = async (entry: string) => {
  const built = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64"));
};
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-browser-check-"));
  (globalThis as any).browser_check_fixture = fixture;
  vision = await bundle('export {analyze_page,capture_view,set_vision_analyzer} from "./electron/browser/vision.ts";');
  live = await bundle('export {run_live_check} from "./electron/check/live.ts";');
});
after(async () => { Reflect.deleteProperty(globalThis, "browser_check_fixture"); await fs.rm(root, { recursive: true, force: true }); });

for (const class_name of ["admin", "adaptive", "address", "add-item", "ad-banner"]) test(`non-ad class ${class_name} stays a regular page`, async () => {
  await fs.writeFile(path.join(root, "index.html"), `<main class="${class_name}"></main>`);
  assert.equal((await page_facts(root)).is_ad, false);
});

for (const html of ['<main class="page ad large"></main>', "<main class='ad'></main>", '<main class=ad></main>']) test(`the actual ad class is recognized ${html}`, async () => {
  await fs.writeFile(path.join(root, "index.html"), html);
  assert.equal((await page_facts(root)).is_ad, true);
});

test("class matching respects token boundaries, attributes and inert source text", async () => {
  for (const html of [
    '<main data-class="ad" class="page"></main>',
    '<main title="a class=ad example" class="page"></main>',
    '<!-- <main class="ad"></main> --><main class="page"></main>',
    '<script>const sample = \'<main class="ad"></main>\';</script>',
    '<style>.page::before{content:\'<main class="ad"></main>\'}</style>',
    '<main class="AD"></main>',
  ]) {
    await fs.writeFile(path.join(root, "index.html"), html);
    assert.equal((await page_facts(root)).is_ad, false, html);
  }
  for (const html of ['<main CLASS="page\tad\nlarge"></main>', '<main title=">" class="ad"></main>']) {
    await fs.writeFile(path.join(root, "index.html"), html);
    assert.equal((await page_facts(root)).is_ad, true, html);
  }
});

const image = { getSize: () => ({ width: 100, height: 80 }), toPNG: () => Buffer.from("old page") };
const tab = () => ({ tab_id: "tab", epoch: 1, url: "https://old.test/", visuals: new Map(), guest: { capturePage: async () => image, isDestroyed: () => false, getURL: () => "https://old.test/", getZoomFactor: () => 1 } });
for (const phase of ["capture", "viewport", "analysis"]) test(`navigation during ${phase} cannot publish a visual for another document`, async () => {
  const page = tab();
  const move = () => { page.epoch++; page.url = "https://new.test/"; page.guest.getURL = () => page.url; };
  page.guest.capturePage = async () => { if (phase === "capture") move(); return image; };
  fixture.viewport = async () => { if (phase === "viewport") move(); return { x: 0, y: 0, width: 100, height: 80 }; };
  vision.set_vision_analyzer(async () => { if (phase === "analysis") move(); return { text: '{"summary":"old pixels","regions":[]}', finish_reason: null }; });
  await assert.rejects(vision.analyze_page(page, "what is shown", new AbortController().signal), /changed|navigat|stale/i);
  assert.equal(page.visuals.size, 0);
});

test("a stable capture keeps its original URL and usable visual", async () => {
  const page = tab();
  fixture.viewport = async () => ({ x: 0, y: 0, width: 100, height: 80 });
  vision.set_vision_analyzer(async () => ({ text: '{"summary":"stable","regions":[]}', finish_reason: null }));
  const answer = await vision.analyze_page(page, "what is shown", new AbortController().signal);
  assert.equal(answer.url, page.url);
  assert.equal(page.visuals.get(answer.screenshot_id).epoch, 1);
});

for (const changed of ["epoch", "url"]) test(`capture rejects a ${changed}-only document change`, async () => {
  const page = tab();
  page.guest.capturePage = async () => {
    if (changed === "epoch") page.epoch++;
    else page.guest.getURL = () => "https://old.test/#section";
    return image;
  };
  fixture.viewport = async () => ({ x: 0, y: 0, width: 100, height: 80 });
  await assert.rejects(vision.capture_view(page, new AbortController().signal), /changed/);
});

test("missing control scripts return absence rather than page exceptions", () => {
  const context = { document: { documentElement: { style: {} }, querySelector: () => null } };
  assert.doesNotThrow(() => vm.runInNewContext(scroll_to_control(1), context));
  assert.equal(vm.runInNewContext(control_box(1), context), null);
});

for (const missing of ["control", "stage"]) test(`a disappearing ${missing} does not abort later layout and viewport checks`, async () => {
  let controls = new Set([0, 1]);
  const shots: string[] = [];
  const document = { documentElement: { style: {} }, querySelector: (selector: string) => {
    const id = Number(/data-live="(\d+)"/.exec(selector)?.[1]);
    return controls.has(id) ? { scrollIntoView() {}, getBoundingClientRect: () => ({ left: id * 100, top: 10, width: 60, height: 30 }) } : null;
  } };
  const sendCommand = async (method: string, params: any) => {
    if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") controls.delete(1);
    if (method !== "Runtime.evaluate") return {};
    const expression = params.expression as string;
    let value: any;
    if (expression.includes("data-live=")) {
      try { value = vm.runInNewContext(expression, { document }); } catch { return { result: {}, exceptionDetails: { text: "Cannot read properties of null" } }; }
    } else if (expression.includes("s.scrollIntoView")) value = missing === "stage" ? {} : null;
    else if (expression.includes("const out = []")) value = [{ i: 0, tag: "BUTTON", type: "button", w: 60, h: 30 }, { i: 1, tag: "BUTTON", type: "button", w: 60, h: 30 }];
    else if (expression.includes("const over =")) value = { stage: null, horizontal_overflow: false, zero_size_canvases: 0 };
    else if (expression.includes("horizontal_overflow")) value = { horizontal_overflow: false };
    else value = null;
    return { result: { value } };
  };
  fixture.window = { webContents: { debugger: { sendCommand, attach() {}, on() {} }, on() {} }, loadURL: async () => {}, setContentSize() {}, isDestroyed: () => false, destroy() {} };
  const answer = await live.run_live_check({ folder: root, project_root: root, fit: [], save: async (name: string) => { shots.push(name); } }, new AbortController().signal);
  assert.deepEqual(answer.errors, []);
  assert.equal(answer.interactions, 1);
  assert.deepEqual(shots, ["wide_a", "wide_still", "wide_b", "narrow", "phone"]);
  assert.notEqual(answer.layout, null);
});

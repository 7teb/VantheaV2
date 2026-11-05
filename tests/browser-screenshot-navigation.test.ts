import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;
const fixture = { snapshot: null as any };
const stubs: Record<string, string> = {
  electron: 'export const nativeImage={};',
  "input.ts": 'export const viewport=async()=>({x:0,y:0,width:100,height:80});export const click_point=async()=>{};',
  "snapshot.ts": 'export const take_snapshot=async()=>globalThis.mediumScreenshotReview.snapshot();',
  "model-image.ts": 'export const fit_native=(image)=>image;export const jpeg_quality=80;',
  "marks.ts": 'export const draw_marks=()=>{};',
  "refs.ts": 'export const sweep_stores=()=>{};',
  "cdp.ts": 'export const cdp=async()=>({});export const ensure_debugger=async()=>{};export const read_frames=async()=>new Map();export const frame_session=()=>"";',
  "target.ts": 'export const describe=()=>"";export const live_node=async()=>({});',
};
const plugin: Plugin = { name: "screenshot-review", setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "review" }));
  api.onResolve({ filter: /[\\/](input|snapshot|model-image|marks|refs|cdp|target)\.ts$/ }, (args) => ({ path: args.path.split(/[\\/]/).pop()!, namespace: "review" }));
  api.onLoad({ filter: /.*/, namespace: "review" }, (args) => ({ loader: "js", contents: stubs[args.path] }));
} };
before(async () => {
  (globalThis as any).mediumScreenshotReview = fixture;
  const built = await build({ stdin: { contents: 'export {take_screenshot} from "./electron/browser/screenshot.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  browser = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64"));
});
after(() => { Reflect.deleteProperty(globalThis, "mediumScreenshotReview"); });

test("a same-document SPA navigation during snapshot collection cannot stamp new URL on old screenshot pixels", async () => {
  let url = "https://app.test/old";
  const image = { getSize: () => ({ width: 100, height: 80 }), toJPEG: () => Buffer.from("old document pixels") };
  const tab = { tab_id: "tab", epoch: 1, visuals: new Map(), guest: { isDestroyed: () => false, getURL: () => url, getZoomFactor: () => 1, capturePage: async () => image } };
  fixture.snapshot = () => { url = "https://app.test/new"; return { snapshot_id: "snapshot", tab_id: "tab", url, title: "new route", lines: [], notes: [] }; };
  await assert.rejects(browser.take_screenshot(tab, false, [], new AbortController().signal), /changed/);
  assert.equal(tab.visuals.size, 0);
});

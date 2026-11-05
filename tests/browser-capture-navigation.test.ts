import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let vision: any;
const plugin: Plugin = { name: "capture-stub", setup(api) {
  api.onResolve({ filter: /[\\/](input|cdp|refs|target)\.ts$/ }, (args) => ({ path: args.path.split(/[\\/]/).pop()!, namespace: "review" }));
  api.onLoad({ filter: /.*/, namespace: "review" }, (args) => ({ loader: "js", contents: args.path === "input.ts" ? 'export const viewport=async()=>({x:0,y:0,width:100,height:80});export const click_point=async()=>{};' : args.path === "cdp.ts" ? 'export const cdp=async()=>({});export const ensure_debugger=async()=>{};export const read_frames=async()=>new Map();export const frame_session=()=>"";' : args.path === "refs.ts" ? 'export const sweep_stores=()=>{};' : 'export const describe=()=>"";export const live_node=async()=>({});' }));
} };
before(async () => {
  const built = await build({ stdin: { contents: 'export {verify_region} from "./electron/browser/vision.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  vision = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64"));
});

test("a navigation during visual target verification cannot validate an old target on the new document", async () => {
  const image = { getSize: () => ({ width: 100, height: 80 }), crop() { return this; }, resize() { return this; }, toBitmap: () => Buffer.alloc(96 * 96 * 4) };
  let url = "https://old.test/";
  const tab = { epoch: 1, guest: { isDestroyed: () => false, getURL: () => url, getZoomFactor: () => 1, capturePage: async () => { tab.epoch++; url = "https://new.test/"; return image; } } };
  const visual = { epoch: 1, url, zoom_factor: 1, scroll_x: 0, scroll_y: 0, capture_width: 100, capture_height: 80, image, retake_tool: "browser_visual_analyze" };
  await assert.rejects(vision.verify_region(tab, visual, { left: 10, top: 10, right: 30, bottom: 30 }, "Target changed.", new AbortController().signal), /changed/);
});

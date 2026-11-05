import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { build, type Plugin } from "esbuild";
import { estimate_tokens, result_cap_tokens, token_prefix } from "../electron/context/estimate.ts";
import { page_windows, read_pages } from "../electron/tools/web/read.ts";
import { file_link_target } from "../src/state/file-link-rules.ts";

test("small token budgets remain strict for CJK, astral and mixed text", () => {
  for (const text of ["汉".repeat(2000), "😀".repeat(2000), "text汉😀".repeat(800)]) {
    for (const budget of [0, 1, 2, 3, 9, 100, 500]) {
      const kept = token_prefix(text, budget);
      assert.ok(estimate_tokens(kept) <= budget, `${budget} => ${estimate_tokens(kept)}`);
      assert.equal(text.startsWith(kept), true);
    }
  }
});

test("read windows do not cut an astral code point and continuation covers the exact suffix", async () => {
  const content = "😀汉".repeat(20000);
  const source = { title: "unicode", url: "https://example.test/unicode", content, published_date: "" };
  for (const budget of [0, 1, 2, 3, 9, 100]) {
    const window = page_windows([source], 0, budget)[0];
    assert.equal(/[\uD800-\uDBFF]$/.test(content.slice(window.start, window.end)), false);
    assert.ok(estimate_tokens(content.slice(window.start, window.end)) <= budget);
  }
  const fetch = async () => new Response(JSON.stringify({ results: [{ url: source.url, title: source.title, raw_content: content }] }), { status: 200 });
  const deps = { key: "fixture", signal: new AbortController().signal, fetch };
  const first = await read_pages({ query: "unicode", urls: [source.url], offset: 0 }, deps);
  const match = /Characters 0 to (\d+) of/.exec(first.text);
  assert.ok(match);
  const end = Number(match[1]);
  assert.ok(end > 0 && end < content.length);
  assert.ok(first.text.endsWith(content.slice(0, end)));
  assert.ok(estimate_tokens(first.text) <= result_cap_tokens);
  const next = await read_pages({ query: "unicode", urls: [source.url], offset: end }, deps);
  assert.match(next.text, new RegExp(`Characters ${end} to `));
  assert.ok(estimate_tokens(next.text) <= result_cap_tokens);
});

test("metadata-only overflow remains capped when long URLs use the body budget", async () => {
  const pages = Array.from({ length: 10 }, (_, index) => ({ url: `https://example.test/${index}?query=${"汉".repeat(5000)}`, title: "title", raw_content: "short" }));
  const result = await read_pages({ query: "q", urls: pages.map((page) => page.url), offset: 0 }, { key: "fixture", signal: new AbortController().signal, fetch: async () => new Response(JSON.stringify({ results: pages }), { status: 200 }) });
  assert.ok(estimate_tokens(result.text) <= result_cap_tokens);
  assert.match(result.text, /truncated/);
});

test("encoded hashes preserve UNC and drive-root identity and are decoded once", () => {
  assert.deepEqual(file_link_target("//server/share/a%23b.txt#L10", "//server/share"), { kind: "project", path: "a#b.txt" });
  assert.deepEqual(file_link_target("//server/other/a%23b.txt#L10", "//server/share"), { kind: "outside", path: "\\\\server\\other\\a#b.txt" });
  assert.deepEqual(file_link_target("D:/a%23b.txt#L10", "D:/"), { kind: "project", path: "a#b.txt" });
  assert.deepEqual(file_link_target("a%2523b.txt#L10", "D:/root"), { kind: "project", path: "a%23b.txt" });
  assert.deepEqual(file_link_target("a%23b.txt:12:4#L10", "D:/root"), { kind: "project", path: "a#b.txt" });
});

test("native view_image retains semitransparent alpha through actual resizing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-read-budget-"));
  const script = path.join(root, "native.cjs");
  const stubs: Plugin = { name: "independent-image-peripherals", setup(api) {
    api.onResolve({ filter: /[\\/]chats[\\/]store\.ts$/ }, (args) => args.importer.endsWith("view-image.ts") ? ({ path: "chats", namespace: "image-review" }) : undefined);
    api.onResolve({ filter: /secret-read\.ts$/ }, () => ({ path: "secrets", namespace: "image-review" }));
    api.onLoad({ filter: /.*/, namespace: "image-review" }, ({ path: file }) => ({ loader: "js", contents: file === "chats" ? "export const get_chat=async()=>({messages:[]});" : "export const secret_read_refused=async()=>null;" }));
  } };
  try {
    await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {app,nativeImage} from 'electron';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import {view_image_tool} from './electron/tools/vision/view-image.ts';
      const root=process.argv[2];app.setPath('userData',path.join(root,'userdata'));
      app.whenReady().then(async()=>{
        const pixels=Buffer.alloc(4*4*4,128);
        const original=nativeImage.createFromBitmap(pixels,{width:4,height:4});
        await fs.writeFile(path.join(root,'alpha.png'),original.toPNG());
        const result=await view_image_tool.execute({chat_id:'fixture',project_root:root,signal:new AbortController().signal,image_fit:[{max_edge:2,patch:1,max_patches:4}]},{path:'alpha.png'});
        const shown=nativeImage.createFromBuffer(result.images[0].bytes);
        console.log('NATIVE_REVIEW='+JSON.stringify({status:result.status,mime:result.images[0].mime,size:shown.getSize(),alpha:shown.toBitmap()[3]}));
        app.exit(0);
      }).catch(error=>{console.error(error);app.exit(1)});
    ` }, bundle: true, platform: "node", format: "cjs", external: ["electron"], outfile: script, plugins: [stubs], logLevel: "silent" });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(path.resolve("node_modules/electron/dist/electron.exe"), [script, root], { encoding: "utf8", env, timeout: 20000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const match = /NATIVE_REVIEW=(.*)/.exec(child.stdout);
    assert.ok(match, child.stdout);
    assert.deepEqual(JSON.parse(match[1]), { status: "done", mime: "image/png", size: { width: 2, height: 2 }, alpha: 128 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

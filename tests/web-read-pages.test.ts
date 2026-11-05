import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { build, type Plugin } from "esbuild";
import { file_link_target } from "../src/state/file-link-rules.ts";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { read_pages } from "../electron/tools/web/read.ts";

test("encoded hashes remain part of filenames while literal fragments are removed", () => {
  assert.deepEqual(file_link_target("docs/a%23b.md#L7", "D:/project"), { kind: "project", path: "docs/a#b.md" });
  assert.deepEqual(file_link_target("file:///C:/outside/a%23b.txt", "D:/project"), { kind: "outside", path: "C:\\outside\\a#b.txt" });
});

test("ten ordinary CJK pages including headings and continuation notes fit the full result cap", async () => {
  const pages = Array.from({ length: 10 }, (_, index) => ({ url: `https://example.com/page-${index}`, title: "Chinese documentation", raw_content: "汉".repeat(2000) }));
  const result = await read_pages({ query: "documentation", urls: pages.map((page) => page.url), offset: 0 }, {
    key: "fixture", signal: new AbortController().signal,
    fetch: async () => new Response(JSON.stringify({ results: pages }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.status, "done");
  assert.ok(estimate_tokens(result.text) <= result_cap_tokens, `actual tokens ${estimate_tokens(result.text)}`);
  for (let index = 0; index < 10; index++) assert.ok(result.text.includes(`page-${index}`));
});

test("multi-page budgeting counts long real URLs and headings as well as body text", async () => {
  const pages = Array.from({ length: 10 }, (_, index) => ({ url: `https://example.com/page-${index}?q=${"a".repeat(1900)}`, title: "文".repeat(160), raw_content: "x".repeat(20000) }));
  const result = await read_pages({ query: "documentation", urls: pages.map((page) => page.url), offset: 0 }, {
    key: "fixture", signal: new AbortController().signal,
    fetch: async () => new Response(JSON.stringify({ results: pages }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.status, "done");
  assert.ok(estimate_tokens(result.text) <= result_cap_tokens, `actual tokens ${estimate_tokens(result.text)}`);
  for (const page of pages) assert.ok(result.text.includes(page.url));
});

test("the actual native view_image tool preserves transparent pixels and keeps JPEG for opaque images", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-read-pages-"));
  const script = path.join(root, "native.cjs");
  const stubs: Plugin = { name: "image-peripherals", setup(api) {
    api.onResolve({ filter: /[\\/]chats[\\/]store\.ts$/ }, (args) => args.importer.endsWith("view-image.ts") ? ({ path: "chats", namespace: "stub" }) : undefined);
    api.onResolve({ filter: /secret-read\.ts$/ }, () => ({ path: "secrets", namespace: "stub" }));
    api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: file }) => ({ loader: "js", contents: file === "chats" ? "export const get_chat=async()=>({messages:[]});" : "export const secret_read_refused=async()=>null;" }));
  } };
  try {
    await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {app,nativeImage} from 'electron';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import {view_image_tool} from './electron/tools/vision/view-image.ts';
      const root=process.argv[2];
      app.setPath('userData',path.join(root,'userdata'));
      app.whenReady().then(async()=>{
        const rows=[];
        for(const [name,alpha] of [['transparent',0],['opaque',255]]){
          const bytes=Buffer.alloc(16,255);bytes[3]=alpha;
          const image=nativeImage.createFromBitmap(bytes,{width:2,height:2});
          await fs.writeFile(path.join(root,name+'.png'),image.toPNG());
          const outcome=await view_image_tool.execute({chat_id:'fixture',project_root:root,signal:new AbortController().signal,image_fit:[{max_edge:2,patch:1,max_patches:4}]},{path:name+'.png'});
          const stored=outcome.images?.[0];
          const decoded=stored?nativeImage.createFromBuffer(stored.bytes):null;
          rows.push({name,status:outcome.status,mime:stored?.mime,alpha:decoded?.toBitmap()[3]});
        }
        console.log('ALPHA_RESULT='+JSON.stringify(rows));app.exit(0);
      }).catch(error=>{console.error(error);app.exit(1)});
    ` }, bundle: true, platform: "node", format: "cjs", external: ["electron"], outfile: script, plugins: [stubs], logLevel: "silent" });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawnSync(path.resolve("node_modules/electron/dist/electron.exe"), [script, root], { encoding: "utf8", env, timeout: 20000, windowsHide: true });
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const match = /ALPHA_RESULT=(.*)/.exec(child.stdout);
    assert.ok(match, child.stdout);
    const rows = JSON.parse(match[1]);
    assert.equal(rows[0].status, "done");
    assert.equal(rows[0].mime, "image/png");
    assert.equal(rows[0].alpha, 0);
    assert.equal(rows[1].mime, "image/jpeg");
    assert.equal(rows[1].alpha, 255);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { build } from "esbuild";

test("native layout changes before a memoized virtual list refresh its viewport", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vx-virtual-"));
  try {
    await fs.mkdir(path.join(dir, "profile"));
    await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import {createElement,useMemo,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {VirtualRows} from './src/components/VirtualRows.tsx';
      let host;let expand;
      const items=Array.from({length:100},(_,i)=>i);
      const Parent=()=>{const [height,setHeight]=useState(0);const [scroller,setScroller]=useState(null);expand=()=>setHeight(400);
        const list=useMemo(()=>createElement(VirtualRows,{items,row_height:10,scroller,className:'virtual',render:i=>createElement('div',{key:i,style:{height:10}},'row'+i)}),[scroller]);
        return createElement('div',{ref:node=>{host=node;setScroller(node)},style:{height:100,overflow:'auto',overflowAnchor:'none'}},createElement('div',{style:{height}},'header'),list)};
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(createElement(Parent)));
      const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.probe=async()=>{await frames();host.scrollTop=500;host.dispatchEvent(new Event('scroll'));await frames();const before=document.querySelector('.virtual span');
        const first=()=>document.querySelector('.virtual>div>div')?.textContent;
        const initial=first();const scroll=host.scrollTop;flushSync(()=>expand());await frames();
        return {initial,after:first(),scroll_before:scroll,scroll_after:host.scrollTop};};
    ` }, outfile: path.join(dir, "renderer.js"), bundle: true, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
    await fs.writeFile(path.join(dir, "index.html"), '<div id="root"></div><script src="renderer.js"></script>');
    await fs.writeFile(path.join(dir, "main.cjs"), `const {app,BrowserWindow}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true}});try{await win.loadFile(path.join(__dirname,'index.html'));const data=await win.webContents.executeJavaScript('window.probe()');console.log('VX_RESULT '+JSON.stringify(data));win.destroy();app.quit()}catch(e){console.error(String(e));app.exit(1)}});`);
    const env = { ...process.env };delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(path.resolve("node_modules/electron/dist/electron.exe"), [path.join(dir, "main.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";let errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });child.stderr.on("data", (chunk) => { errors += chunk; });
    const timer = setTimeout(() => child.kill(), 20000);
    const code = await new Promise((resolve, reject) => { child.once("error", reject);child.once("exit", resolve); });
    clearTimeout(timer);
    assert.equal(code, 0, errors.slice(-1000));
    const line = output.split(/\r?\n/).find((entry) => entry.startsWith("VX_RESULT "));
    assert.ok(line, output + errors.slice(-1000));
    const observed = JSON.parse(line.slice("VX_RESULT ".length));
    assert.equal(observed.initial, "row42", JSON.stringify(observed));
    assert.equal(observed.scroll_before, observed.scroll_after, JSON.stringify(observed));
    assert.equal(observed.after, "row2", JSON.stringify(observed));
  } finally { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

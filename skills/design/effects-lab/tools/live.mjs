// Real time browser check over the Chrome DevTools Protocol. No dependencies, needs Node 22+ (global WebSocket).
// Usage: node live.mjs <index.html path> <shots dir>
// Prints one JSON object on the last line: { errors: [], shots: {...}, interactions: n }
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , indexPath, shotsDir] = process.argv;
/* Browser detection for Windows, macOS and Linux. CHECK_BROWSER overrides everything. */
function find_browser() {
  if (process.env.CHECK_BROWSER && existsSync(process.env.CHECK_BROWSER)) return process.env.CHECK_BROWSER;
  const fixed = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(existsSync);
  if (fixed) return fixed;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']) {
    const r = spawnSync(finder, [name], { encoding: 'utf8' });
    const hit = r.status === 0 && r.stdout.split(/\r?\n/).find((l) => l.trim() && existsSync(l.trim()));
    if (hit) return hit.trim();
  }
  return null;
}
const browser = find_browser();
if (!browser) { console.log(JSON.stringify({ fatal: 'no Edge, Chrome or Chromium was found' })); process.exit(0); }
mkdirSync(shotsDir, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 600);
const prof = mkdtempSync(join(tmpdir(), 'live_'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1440,1100', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { errors: [], shots: {}, interactions: 0, notes: [] };
let ws, seq = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});

function finish(code = 0) {
  const seen = new Map(); result.errors.forEach((e) => seen.set(e, (seen.get(e) || 0) + 1));
  result.errors = [...seen].map(([e, n]) => (n > 1 ? `${e}  (x${n})` : e));
  try { ws && ws.close(); } catch {}
  try { proc.kill(); } catch {}
  setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} console.log(JSON.stringify(result)); process.exit(code); }, 400);
}
/* A normal run takes 20 to 45 seconds. An ad plays up to 20 more seconds of scenes. A busy machine can double that. */
setTimeout(() => { result.errors.push('live check timed out after 170s. If the machine is busy run the checker again. If it happens every time the page is stuck, for example an endless loop or a very heavy frame'); finish(0); }, 170000);

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('could not reach the browser debug port');
}

const noise = /fonts\.g|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION|Failed to load resource.*(fonts|gstatic)/i;
function on_event(m) {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const where = d.url ? d.url.split('/').pop() + ':' + (d.lineNumber + 1) : '';
    result.errors.push(`exception ${where} ${(d.exception && d.exception.description || d.text || '').split('\n')[0]}`.slice(0, 240));
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const t = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (!noise.test(t)) result.errors.push('console.error ' + t.slice(0, 220));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const e = m.params.entry;
    if (!noise.test(e.text + (e.url || ''))) result.errors.push(`log ${e.text} ${(e.url || '').split('/').pop()}`.slice(0, 220));
  }
}

async function shot(name, clip) {
  const r = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const f = join(shotsDir, name + '.png'); writeFileSync(f, Buffer.from(r.data, 'base64')); result.shots[name] = f;
}
const evalJs = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.value;
};
const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else on_event(m);
  };
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: pathToFileURL(resolve(indexPath)).href });
  await call('Page.bringToFront');
  await sleep(2500);                                    // real time, so animations and loops really run
  await evalJs(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);   // two real frames
  await call('Page.captureScreenshot', { format: 'png' });   // warm up shot, the first capture can be blank, it is thrown away
  await sleep(700);

  await shot('wide_a');
  await sleep(1500); await shot('wide_still');           // no pointer input between these two, so any difference is idle motion

  // scenes: if the page has a timeline (an element with data-scene), play it for up to 20 seconds and shoot every new scene
  const has_scenes = await evalJs(`(() => { const h = document.querySelector('[data-scene]'); if (!h) return false; h.scrollIntoView({block:'center'}); return true; })()`);
  if (has_scenes) {
    result.scenes = []; let shots_taken = 0; const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = await evalJs(`(document.querySelector('[data-scene]') || {dataset:{}}).dataset.scene`);
      if (s !== undefined && s !== null && result.scenes[result.scenes.length - 1] !== s) {
        result.scenes.push(s);
        if (shots_taken < 6) { await sleep(900); await shot('scene_' + String(shots_taken).padStart(2, '0') + '_s' + s); shots_taken++; }   // let the slots finish entering
      }
      if (new Set(result.scenes).size >= 4 && result.scenes.length >= 5) break;
      await sleep(300);
    }
    await evalJs(`window.scrollTo(0, 0)`);
  }
  // find the stage, move the pointer across it, then shoot again
  const box = await evalJs(`(() => { const s = document.querySelector('.stage, .ad'); if (!s) return null; s.scrollIntoView({block:'center'}); const r = s.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`);
  await sleep(500);
  if (box) {
    const b = await evalJs(`(() => { const r = document.querySelector('.stage, .ad').getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`);
    for (let i = 0; i <= 14; i++) { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.w * (0.2 + 0.6 * i / 14), y: b.y + b.h * (0.3 + 0.35 * Math.sin(i / 3)) }); await sleep(40); }
    await mouse('mousePressed', b.x + b.w * 0.5, b.y + b.h * 0.5); await sleep(120); await mouse('mouseReleased', b.x + b.w * 0.5, b.y + b.h * 0.5);
    result.interactions += 1;
  } else result.notes.push('no .stage or .ad element found');
  await sleep(1200);
  await shot('wide_b');

  // exercise every control: click buttons, drag ranges, type in fields
  const ctl = await evalJs(`(() => {
    const out = [];
    document.querySelectorAll('.controls button, .controls input, .controls select, .stage button, .ad button').forEach((el, i) => {
      el.dataset.live = i; const r = el.getBoundingClientRect(); out.push({ i, tag: el.tagName, type: el.type || '', w: r.width, h: r.height });
    }); return out; })()`);
  for (const c of ctl || []) {
    if (c.w === 0 || c.h === 0) continue;
    await evalJs(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('[data-live="${c.i}"]').scrollIntoView({block:'center'}); })()`);   // smooth scrolling would still be moving when we read the position
    await sleep(120);
    const r = await evalJs(`(() => { const r = document.querySelector('[data-live="${c.i}"]').getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`);
    if (c.type === 'range') {
      for (const f of [0.1, 0.9, 0.5]) { await mouse('mousePressed', r.x + r.w * f, r.y + r.h / 2); await mouse('mouseReleased', r.x + r.w * f, r.y + r.h / 2); await sleep(60); }
    } else if (c.type === 'text' || c.tag === 'TEXTAREA') {
      await mouse('mousePressed', r.x + 10, r.y + r.h / 2); await mouse('mouseReleased', r.x + 10, r.y + r.h / 2);
      await call('Input.insertText', { text: 'TEST' }); await sleep(100);
    } else {
      await mouse('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await mouse('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); await sleep(250);
    }
    result.interactions += 1;
  }
  await sleep(600);

  // ad: also make sure the last Format button really applied (the last control the loop clicked sets the final state)
  if (has_scenes) result.ad_format = await evalJs(`(document.querySelector('.ad') || {dataset:{}}).dataset.format`);

  // layout facts
  result.layout = await evalJs(`(() => {
    const s = document.querySelector('.stage, .ad'); const r = s ? s.getBoundingClientRect() : null;
    const over = document.documentElement.scrollWidth > window.innerWidth + 2;
    const blank = [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width < 4 || c.getBoundingClientRect().height < 4).length;
    return { stage: r ? [Math.round(r.width), Math.round(r.height)] : null, horizontal_overflow: over, zero_size_canvases: blank, fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
  })()`);

  // narrow
  await call('Emulation.setDeviceMetricsOverride', { width: 800, height: 1100, deviceScaleFactor: 1, mobile: false });
  await sleep(900); await shot('narrow');
  result.layout_narrow = await evalJs(`({ horizontal_overflow: document.documentElement.scrollWidth > window.innerWidth + 2 })`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(900); await shot('phone');
  result.layout_phone = await evalJs(`({ horizontal_overflow: document.documentElement.scrollWidth > window.innerWidth + 2 })`);
} catch (e) {
  result.errors.push('live check crashed: ' + e.message);
}
finish(0);

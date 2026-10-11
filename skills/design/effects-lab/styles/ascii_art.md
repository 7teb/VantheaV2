# ASCII art

Look: monospace characters as pixels. Phosphor green `#8dffb0` on `#030805`, soft glow, a ramp of 10 characters from empty to dense. A calm terminal feel, no scanline gimmicks.
Stage: `<pre class="ascii" id="ascii">` filling a `.stage.h_lg`. The characters are the image.

## Technique
1. Brightness ramp: `' .:-=+*#%@'`. Value 0 to 1 picks a character.
2. Measure the real character width, then compute `cols` and `rows` from the stage size. Characters are about 0.6 as wide as they are tall, so field math must correct for it.
3. Each frame, compute a brightness field for every cell, map to characters, join into one string, assign it once to `pre.textContent`.
4. Fields: plasma, ripple (follows the pointer), donut (3D), type (a word rendered through an offscreen canvas).

## Code
```css
.ascii { position: absolute; inset: 0; margin: 0; overflow: hidden; white-space: pre;
  font: 11px/11px var(--mono); letter-spacing: 0; color: #8dffb0; text-shadow: 0 0 8px rgba(141,255,176,.45); user-select: none; }
.stage.ascii_stage { background: radial-gradient(90% 90% at 50% 40%, #07140b, #030805); }
```
```js
const stage = $('#stage'), pre = $('#ascii'), ptr = pointer_in(stage);
const RAMP = ' .:-=+*#%@';
const LH = 11;
let cols = 0, rows = 0, cw = 6.6, mode = 'plasma', word = 'ASCII';
let buf = [];
const off = document.createElement('canvas'), octx = off.getContext('2d', { willReadFrequently: true });   // declared BEFORE resize() can run

function measure() {
  const s = document.createElement('span'); s.textContent = 'M'.repeat(60); s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  pre.appendChild(s); const w = s.getBoundingClientRect().width / 60; s.remove(); return w || 6.6;
}
function resize() {
  cw = measure(); cols = Math.max(10, Math.floor(stage.clientWidth / cw)); rows = Math.max(6, Math.floor(stage.clientHeight / LH));
  buf = new Array(cols * rows).fill(0);
  off.width = cols; off.height = rows;
  // Tile the stage exactly: spread the leftover pixels over the characters so the text reaches every edge.
  pre.style.letterSpacing = ((stage.clientWidth - cols * cw) / cols).toFixed(3) + 'px';
  pre.style.lineHeight = (stage.clientHeight / rows).toFixed(3) + 'px';
}
new ResizeObserver(resize).observe(stage);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);   // a late web font swap changes the character width

function plasma(t) {
  const W = cols * cw, H = rows * LH;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const u = (x * cw - W / 2) / (H / 2), v = (y * LH - H / 2) / (H / 2);
    const a = Math.sin(u * 3 + t) + Math.sin(v * 3 - t * 1.3) + Math.sin(Math.hypot(u, v) * 4 - t * 2);
    buf[y * cols + x] = (a + 3) / 6;
  }
}
function ripple(t) {
  const W = cols * cw, H = rows * LH;
  const pu = ptr.inside ? (ptr.x - W / 2) / (H / 2) : Math.sin(t * .5) * .8, pv = ptr.inside ? (ptr.y - H / 2) / (H / 2) : Math.cos(t * .4) * .5;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const u = (x * cw - W / 2) / (H / 2), v = (y * LH - H / 2) / (H / 2), d = Math.hypot(u - pu, v - pv);
    buf[y * cols + x] = clamp(.5 + .5 * Math.sin(d * 14 - t * 4) * Math.exp(-d * 1.1) * (ptr.down ? 1.6 : 1), 0, 1);
  }
}
function type(t) {
  // draw in SCREEN pixels, then scale so one canvas pixel equals one character cell (cw wide, LH tall)
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.fillStyle = '#000'; octx.fillRect(0, 0, cols, rows);
  octx.setTransform(1 / cw, 0, 0, 1 / LH, 0, 0);
  octx.fillStyle = '#fff'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
  const fs = Math.min(rows * LH * .8, cols * cw * 1.5 / Math.max(2, word.length));
  octx.font = `800 ${fs}px Inter, sans-serif`; octx.fillText(word, cols * cw / 2, rows * LH / 2);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  const d = octx.getImageData(0, 0, cols, rows).data;
  for (let i = 0; i < cols * rows; i++) buf[i] = (d[i * 4] / 255) * (.7 + .3 * noise2((i % cols) * .2, Math.floor(i / cols) * .2 + t));
}
function donut(t) {
  // A is a breathing 3/4 view so the hole stays readable. A full tumble (A = t * .9) turns into a blob for a third of the cycle.
  // ky is .56 of the rows. .7 clips the top and bottom on a wide stage.
  buf.fill(-1); const zb = new Float32Array(cols * rows), A = 1.15 + Math.sin(t * .35) * .35, B = t * .6;
  const cA = Math.cos(A), sA = Math.sin(A), cB = Math.cos(B), sB = Math.sin(B);
  const ky = rows * .56, kx = ky * LH / cw;
  for (let th = 0; th < TAU; th += .07) {
    const ct = Math.cos(th), st = Math.sin(th);
    for (let ph = 0; ph < TAU; ph += .025) {
      const cp = Math.cos(ph), sp = Math.sin(ph), cx = 2 + ct;
      const x = cx * (cB * cp + sA * sB * sp) - st * cA * sB, y = cx * (sB * cp - sA * cB * sp) + st * cA * cB;
      const z = 5 + cA * cx * sp + st * sA, ooz = 1 / z;
      const xp = Math.floor(cols / 2 + kx * ooz * x), yp = Math.floor(rows / 2 - ky * ooz * y);
      const L = cp * ct * sB - cA * ct * sp - sA * st + cB * (cA * st - ct * sA * sp);
      if (xp >= 0 && xp < cols && yp >= 0 && yp < rows && L > 0 && ooz > zb[yp * cols + xp]) { zb[yp * cols + xp] = ooz; buf[yp * cols + xp] = Math.min(1, .15 + L * .85); }
    }
  }
  for (let i = 0; i < buf.length; i++) if (buf[i] < 0) buf[i] = 0;
}
const fields = { plasma, ripple, type, donut };
animate_when_visible(stage, (t) => {
  if (!cols) return;
  fields[mode](t / 1000);
  let out = '';
  for (let y = 0; y < rows; y++) {
    let line = ''; for (let x = 0; x < cols; x++) line += RAMP[Math.min(RAMP.length - 1, Math.floor(buf[y * cols + x] * RAMP.length))];
    out += line + (y < rows - 1 ? '\n' : '');
  }
  pre.textContent = out;
});
resize();
```
Colors (swatch): phosphor `#8dffb0`, amber `#ffb347`, ice `#9fd8ff`. Set color and text-shadow rgba from JS on the pre.

## Controls
`seg` Plasma / Ripple / Type / Donut, `swatches` for 3 colors, a text `field` for the word that is visible ONLY in Type mode (toggle `hidden` on its wrapper inside the seg callback), so every visible control changes the stage. Sanitise it with `.toUpperCase().slice(0, 12)`.

## Pitfalls
- Using a proportional font. It must be monospace and `letter-spacing: 0`.
- Setting `innerHTML` per row per frame is slow. Build one string and set `textContent` once.
- Stretched circles: forgot the width to height correction `cw / LH`.
- Rows larger than the stage: cap at `floor(height / LH)`.

## Done when
Moving characters fill the whole stage edge to edge, the donut rotates with believable shading, Type mode reads the word clearly, the pointer visibly disturbs Ripple.

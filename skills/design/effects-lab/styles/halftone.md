# Halftone

Look: printed dots on paper. Warm paper stage `#f4efe4`, ink dots. Two modes: single ink (black dots on paper) and four color print (cyan `#00aeef`, magenta `#ec008c`, yellow `#fff200`, black `#141414`) where the layers overlap and mix with multiply. The picture is a moving scene made of soft colored blobs, drawn first to a hidden low res canvas, then converted to dots.
Stage: `<canvas class="fill" id="h_canvas">` in `.stage.h_lg`, set `background: #f4efe4` on the stage.

## Technique
1. Hidden source canvas `src` at one third of the stage size. Draw the scene there (white background, colored radial blobs orbiting, one dark blob under the pointer).
2. Read its pixels once per frame with `getImageData`.
3. For each ink, walk a grid rotated by that ink's screen angle (C 15, M 75, Y 0, K 45 degrees). For each grid point sample the source, compute coverage 0 to 1, draw a circle with radius `sqrt(coverage) * gap * 0.72`.
4. Batch all circles of one ink into ONE path and fill once. Fifty thousand separate fills will freeze the page.
5. Use `globalCompositeOperation = 'multiply'` for the four color mode.

## Code
```js
const canvas = $('#h_canvas'), c = fit_canvas(canvas, size_source), ptr = pointer_in(canvas);
const src = document.createElement('canvas'), sctx = src.getContext('2d', { willReadFrequently: true });
const K = 3;                     // source pixels are 3 css pixels
let SW = 1, SH = 1, gap = 9, mode = 'cmyk';
function size_source() { SW = Math.max(8, Math.floor(c.w / K)); SH = Math.max(8, Math.floor(c.h / K)); src.width = SW; src.height = SH; }
size_source();

const BLOBS = ['#00aeef', '#ec008c', '#fff200', '#00aeef'];       // same yellow as the ink
function draw_source(s) {
  sctx.globalCompositeOperation = 'source-over'; sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, SW, SH);
  BLOBS.forEach((col, i) => {
    const x = SW * (.5 + .3 * Math.sin(s * .6 + i * 2.1)), y = SH * (.5 + .28 * Math.cos(s * .5 + i * 1.7)), r = SH * (.38 + .06 * Math.sin(s + i));
    const g = sctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
    sctx.fillStyle = g; sctx.beginPath(); sctx.arc(x, y, r, 0, TAU); sctx.fill();
  });
  if (ptr.inside) {
    const x = ptr.x / K, y = ptr.y / K, r = SH * pr, g = sctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#111'); g.addColorStop(1, 'rgba(17,17,17,0)'); sctx.fillStyle = g; sctx.beginPath(); sctx.arc(x, y, r, 0, TAU); sctx.fill();
  }
}
const INKS = [
  { color: '#00aeef', angle: 15, cov: (r, g, b) => { const k = 1 - Math.max(r, g, b) / 255; return k >= 1 ? 0 : (1 - r / 255 - k) / (1 - k); } },
  { color: '#ec008c', angle: 75, cov: (r, g, b) => { const k = 1 - Math.max(r, g, b) / 255; return k >= 1 ? 0 : (1 - g / 255 - k) / (1 - k); } },
  { color: '#fff200', angle: 0, cov: (r, g, b) => { const k = 1 - Math.max(r, g, b) / 255; return k >= 1 ? 0 : (1 - b / 255 - k) / (1 - k); } },
  { color: '#141414', angle: 45, cov: (r, g, b) => 1 - Math.max(r, g, b) / 255 },
];
const MONO = [{ color: '#141414', angle: 45, cov: (r, g, b) => 1 - (r * .3 + g * .59 + b * .11) / 255 }];

function layer(ink, data) {
  const ctx = c.ctx, a = ink.angle * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), R = Math.hypot(c.w, c.h) / 2;
  ctx.fillStyle = ink.color; ctx.beginPath();
  for (let v = -R; v < R; v += gap) for (let u = -R; u < R; u += gap) {
    const x = c.w / 2 + u * cs - v * sn, y = c.h / 2 + u * sn + v * cs;
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) continue;
    const i = (Math.min(SH - 1, Math.floor(y / K)) * SW + Math.min(SW - 1, Math.floor(x / K))) * 4,    // clamp, or the right edge reads the next row cov = clamp(ink.cov(data[i], data[i + 1], data[i + 2]), 0, 1);
    const r = Math.sqrt(cov) * gap * .72; if (r < .35) continue;
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
}
animate_when_visible(canvas, (t) => {
  draw_source(t / 1000);
  const data = sctx.getImageData(0, 0, SW, SH).data, ctx = c.ctx;
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#f4efe4'; ctx.fillRect(0, 0, c.w, c.h);
  ctx.globalCompositeOperation = mode === 'cmyk' ? 'multiply' : 'source-over';
  (mode === 'cmyk' ? INKS : MONO).forEach((ink) => layer(ink, data));
  ctx.globalCompositeOperation = 'source-over';
});
seg($('#mode'), (b) => { mode = b.dataset.mode; });
slider($('#gap'), $('#gap_out'), (v) => { gap = v; });
```
Dot size slider 6 to 18 (it is the grid gap), default 9. At 6 the page draws roughly 86 thousand arcs per frame across four inks, so keep the batching (one path per ink).
The pointer blob radius must be smoothed, not switched: keep `let pr = .22;` in the state and in the frame `pr = damp(pr, ptr.down ? .34 : .22, 8, dt);` before `draw_source`, then use `pr` as above (pass `dt` into `draw_source`).
Optional: a Paper grain overlay `<div class="grain">` using an SVG `feTurbulence` data URI with `mix-blend-mode: multiply; opacity: .25`. Optional: tiny registration marks in the corners drawn as 2 thin crossing lines.

## Controls
`seg` Color / Mono, slider Dot size 6 to 18, `seg` Scene (Blobs / Pulse) optional.

## Pitfalls
- One `fill()` per dot is very slow. One path per ink.
- Dots in one grid angle look like a moire grid, that is why the angles differ. Keep 15, 75, 0, 45.
- Do not apply `multiply` over a dark stage. The paper must be light.
- Source canvas resized every frame clears it and thrashes memory. Resize only in `size_source`.

## Done when
Overlapping inks produce rosettes and mixed colors, dot size follows brightness smoothly, the dark pointer blob prints black dots under the cursor, Mono mode looks like newsprint.

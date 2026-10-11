# Pixel art

Look: a low resolution canvas scaled up with hard pixels. A 16 color palette, ordered dithering instead of smooth gradients, parallax scenery, a walking sprite, a little paint tool. Type in `Press Start 2P` (add `family=Press+Start+2P` to the fonts URL, fallback monospace) only for tiny labels.
Palette (PICO-8): `#000000 #1d2b53 #7e2553 #008751 #ab5236 #5f574f #c2c3c7 #fff1e8 #ff004d #ffa300 #ffec27 #00e436 #29adff #83769c #ff77a8 #ffccaa`
Stage: two stages in a `.pair` grid (`grid-template-columns: 1.7fr 1fr; gap: 16px`, one column under 860px). Left: the scene canvas. Right: the paint stage, `<div class="stage paint_stage">` holding the canvas. The scene stage has class `h_md`. The paint stage is square: `.paint_stage { aspect-ratio: 1; height: auto; }`, and the canvas inside is `position: absolute; inset: 0; width: 100%; height: 100%`. Never put `aspect-ratio` on the canvas itself. Under 860px the grid is one column and the paint stage becomes `max-width: 420px; margin: 0 auto; width: 100%`.

## Technique
1. Logical canvas is tiny: height 90 pixels, width from the stage ratio. CSS stretches it: `width: 100%; height: 100%; image-rendering: pixelated`.
2. Never draw at half pixels. Use `Math.floor` for every position. `ctx.imageSmoothingEnabled = false`.
3. Sky is a vertical gradient made with a 4x4 Bayer matrix: pick between two palette colors depending on whether the fractional position is above the Bayer threshold. Render it once to an offscreen canvas on resize, then `drawImage` each frame.
4. Parallax: three mountain or city layers, each a column height function from `noise2`, moving at different speeds.
5. Sprite: strings of characters mapped to palette colors. Two frames, switched every 180ms.
6. Stars twinkle by turning on and off in a pattern, never by alpha.
7. Paint tool: a 32 by 32 grid, drag to draw with the selected swatch, Clear button.

## Code
```js
const PAL = ['#000000','#1d2b53','#7e2553','#008751','#ab5236','#5f574f','#c2c3c7','#fff1e8','#ff004d','#ffa300','#ffec27','#00e436','#29adff','#83769c','#ff77a8','#ffccaa'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const canvas = $('#px_canvas'), stage = $('#px_stage'), ctx = canvas.getContext('2d');
const H = 90; let W = 160, sky = null, speed = 1;
const SKY = ['#1d2b53', '#7e2553', '#ff004d', '#ffa300'];

function init_size() {
  W = Math.max(90, Math.round(H * stage.clientWidth / Math.max(1, stage.clientHeight)));
  canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false;
  sky = document.createElement('canvas'); sky.width = W; sky.height = H;
  const sc = sky.getContext('2d');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.min(1, y / (H * .72)) * (SKY.length - 1), i = Math.min(SKY.length - 2, Math.floor(v)), f = v - i;
    sc.fillStyle = f > BAYER[(y % 4) * 4 + (x % 4)] / 16 ? SKY[i + 1] : SKY[i]; sc.fillRect(x, y, 1, 1);
  }
}
new ResizeObserver(init_size).observe(stage); init_size();

const HERO = { s: '#ffccaa', h: '#ab5236', b: '#29adff', p: '#1d2b53', k: '#000000', e: '#000000' };
const WALK = [
  ['..hhhh..', '.hhhhhh.', '.sesses.', '..ssss..', '.bbbbbb.', 'sbbbbbbs', '.bbbbbb.', '..pppp..', '..p..p..', '.kk..kk.'],
  ['..hhhh..', '.hhhhhh.', '.sesses.', '..ssss..', '.bbbbbb.', 'sbbbbbbs', '.bbbbbb.', '..pppp..', '.pp..pp.', 'kk....kk'],
];
function sprite(rows, map, x, y) {
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') { ctx.fillStyle = map[ch]; ctx.fillRect(x + i, y + j, 1, 1); } }));
}
const stars = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random() * .5, ph: Math.random() * 10 }));
function mountains(t, speed_k, base, amp, color, seed) {
  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) { const h = Math.floor(base + amp * noise2((x + t * speed_k) * .045, seed)); ctx.fillRect(x, H - h, 1, h); }
}
animate_when_visible(stage, (ms) => {
  const t = ms / 1000 * speed;
  ctx.drawImage(sky, 0, 0);
  stars.forEach((s) => { if (Math.sin(t * 2 + s.ph) > .2) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(Math.floor(s.x * W), Math.floor(s.y * H), 1, 1); } });
  // moon: scan a disc
  for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) if (x * x + y * y <= 49) { ctx.fillStyle = x * x + y * y > 40 ? '#c2c3c7' : '#fff1e8'; ctx.fillRect(Math.floor(W * .78) + x, 16 + y, 1, 1); }
  mountains(t, 6, 24, 18, '#83769c', 1.3);
  mountains(t, 14, 18, 14, '#5f574f', 7.7);
  mountains(t, 30, 16, 8, '#1d2b53', 3.1);      // base 16 so the near layer clears the ground band and reads as a real third layer
  ctx.fillStyle = '#008751'; ctx.fillRect(0, H - 12, W, 12);
  ctx.fillStyle = '#00e436'; ctx.fillRect(0, H - 12, W, 1);
  ctx.fillStyle = '#ab5236';
  for (let x = 0; x < W + 6; x += 6) { const gx = (((x - t * 40) % (W + 6)) + (W + 6)) % (W + 6) - 6; ctx.fillRect(Math.floor(gx), H - 6, 3, 1); }
  const frame = Math.floor(t * 5.5) % 2;
  sprite(WALK[frame], HERO, Math.floor(W * .3), H - 22 + (frame ? 0 : 1));   // 10 rows tall, feet on the ground line at H - 12
});
slider($('#speed'), $('#speed_out'), (v) => { speed = v / 10; });
```
Paint tool:
```js
const pc = $('#paint_canvas'), pctx = pc.getContext('2d'); pc.width = 32; pc.height = 32;
let color = PAL[8];
pctx.fillStyle = PAL[0]; pctx.fillRect(0, 0, 32, 32);
function paint(e) {
  const r = pc.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * 32), y = Math.floor((e.clientY - r.top) / r.height * 32);
  if (x < 0 || y < 0 || x > 31 || y > 31) return; pctx.fillStyle = color; pctx.fillRect(x, y, 1, 1);
}
let drawing = false;
pc.addEventListener('pointerdown', (e) => { drawing = true; pc.setPointerCapture(e.pointerId); paint(e); });
pc.addEventListener('pointermove', (e) => { if (drawing) paint(e); });
pc.addEventListener('pointerup', () => { drawing = false; });
```
Swatches: build 16 `.sw` buttons from `PAL` with `style="--c: ..."` into `#pal`, pressed state on the active one (use the same `seg` helper on the container). Canvas CSS for paint: `touch-action: none; cursor: crosshair; width: 100%; height: 100%; image-rendering: pixelated`. Clear button refills with black and redraws the small heart sprite at low contrast, so the paint panel never looks empty. Pre fill the paint canvas with a tiny smiley or heart sprite via `sprite`-like loop so the right side is not empty at first. The two low resolution canvases are the allowed exception to `fit_canvas`, add a comment `/* low res canvas, sized on purpose */` in app.js.

## Controls
`swatches` 16 colors (paint), button Clear, slider Speed 0 to 30.

## Pitfalls
- Smooth blurry result: forgot `image-rendering: pixelated` or drew at fractional coordinates.
- Canvas drawn at full size then CSS scaled down is not pixel art. Logical size must be small.
- More than one tone per surface looks noisy. Stay on the palette.
- Gradients with `createLinearGradient` are forbidden. Use dither.

## Done when
Crisp chunky pixels, dithered sunset sky, three parallax layers sliding at different speeds, a sprite that walks with a bob, stars that blink, painting with the mouse works.

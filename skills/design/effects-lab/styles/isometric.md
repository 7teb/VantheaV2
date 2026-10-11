# Isometric

Look: a grid of blocks seen from a 30 degree angle, flat shaded in three tones (top light, left mid, right dark), a calm dark stage `#05060a`, a pulse wave running through block heights, one accent hue. Clean vector feel.
Stage: `<canvas class="fill" id="iso_canvas">` in `.stage.h_lg`.

## Technique
1. Projection: `sx = (x - y) * S * 0.866 + ox`, `sy = (x + y) * S * 0.5 - z * S + oy`. x grows right and down, y grows left and down.
2. A block at cell (x, y) with height h has 3 visible faces:
   - top: (x,y,h) (x+1,y,h) (x+1,y+1,h) (x,y+1,h)
   - right: (x+1,y,0) (x+1,y+1,0) (x+1,y+1,h) (x+1,y,h)
   - left: (x,y+1,0) (x+1,y+1,0) (x+1,y+1,h) (x,y+1,h)
3. Draw back to front: sort cells by `x + y` ascending.
4. Heights come from a function of time and distance to the pointer cell, so no per cell state is needed.
5. The pointer is converted back to a grid cell with the inverse: `u = (sx - ox) / (S*0.866)`, `v = (sy - oy) / (S*0.5)`, `x = (u + v) / 2`, `y = (v - u) / 2`. This is valid at height 0.
6. Shade: one base hue per cell from height, lightness top 62, left 46, right 32.
7. Smooth everything the pointer touches (hover cell and hover strength use `damp`), and clamp heights to `MAX_H` so no block ever leaves the canvas.

## Code
```js
function init() {
  const canvas = $('#iso_canvas'), c = fit_canvas(canvas), ptr = pointer_in(canvas);
  let N = 12, S = 30, ox = 0, oy = 0, hue0 = 255, accent = 1, mode = 'waves', click = null;
  let hx = 0, hy = 0, hx_s = 0, hy_s = 0, hover = 0;       // hx, hy raw pointer cell. hx_s, hy_s smoothed. hover ramps 0 to 1.
  const MAX_H = 4.5;                                        // tallest block allowed, hover and click included
  let cells = [];
  function build() { cells = []; for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) cells.push({ x, y }); cells.sort((a, b) => (a.x + a.y) - (b.x + b.y)); }
  build();

  /* Fit the whole field. The diamond is N * 1.732 * S wide and N * S tall, the tallest block adds MAX_H * S above it.
     S is the largest value that fits both the width and the height. Then center the whole span vertically. */
  function layout() {
    S = Math.min(c.w * .94 / (1.732 * N), (c.h - 28) / (N + MAX_H));
    ox = c.w / 2;
    oy = (c.h - (N + MAX_H) * S) / 2 + MAX_H * S;           // oy is where the back corner (0,0) sits at height 0
  }
  const P = (x, y, z) => [(x - y) * S * .866 + ox, (x + y) * S * .5 - z * S + oy];
  function poly(pts, fill) {
    const ctx = c.ctx; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function height(x, y, s) {
    let h;
    if (mode === 'city') h = 1 + noise2(x * .4, y * .4) * 3 + .3 * Math.sin((x + y) * .5 - s * 1.1);
    else if (mode === 'stairs') h = (x + y) / N * 3 + .2 * Math.sin((x + y) * .6 - s * 1.5);
    else h = .5 + .35 * Math.sin((x + y) * .55 - s * 1.8) + .25 * Math.sin(x * .7 + s * .9) * Math.cos(y * .6 - s * .7);
    if (hover > .01) { const d = Math.hypot(x + .5 - hx_s, y + .5 - hy_s); h += 2.4 * hover * Math.exp(-d * d / 5) * (ptr.down ? 1.4 : 1); }
    if (click) { const d = Math.hypot(x - click.x, y - click.y), age = s - click.t; h += 1.6 * Math.exp(-Math.abs(d - age * 5) * 1.2) * Math.exp(-age * .9); }
    return clamp(h, .12, MAX_H);
  }
  canvas.addEventListener('pointerdown', () => { click = { x: hx, y: hy, t: performance.now() / 1000 }; });

  function frame(t, dt) {
    layout(); const s = t / 1000;
    const u = (ptr.x - ox) / (S * .866), v = (ptr.y - oy) / (S * .5); hx = (u + v) / 2; hy = (v - u) / 2;
    hx_s = damp(hx_s, hx, 10, dt); hy_s = damp(hy_s, hy, 10, dt); hover = damp(hover, ptr.inside ? 1 : 0, 6, dt);
    const ctx = c.ctx;
    const bg = ctx.createRadialGradient(c.w / 2, c.h * .45, 0, c.w / 2, c.h * .45, c.w * .6); bg.addColorStop(0, '#0d1020'); bg.addColorStop(1, '#05060a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);
    // soft ground shadow under the field
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 40; ctx.fillStyle = 'rgba(0,0,0,.55)';
    const a = P(0, 0, 0), b = P(N, 0, 0), d2 = P(N, N, 0), e = P(0, N, 0);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d2[0], d2[1]); ctx.lineTo(e[0], e[1]); ctx.closePath(); ctx.fill(); ctx.restore();
    for (const k of cells) {
      const h = height(k.x, k.y, s), hue = (((hue0 + h * 30 * accent) % 360) + 360) % 360;
      poly([P(k.x + 1, k.y, 0), P(k.x + 1, k.y + 1, 0), P(k.x + 1, k.y + 1, h), P(k.x + 1, k.y, h)], `hsl(${hue},62%,32%)`);   // right, darkest
      poly([P(k.x, k.y + 1, 0), P(k.x + 1, k.y + 1, 0), P(k.x + 1, k.y + 1, h), P(k.x, k.y + 1, h)], `hsl(${hue},62%,46%)`);   // left, mid
      poly([P(k.x, k.y, h), P(k.x + 1, k.y, h), P(k.x + 1, k.y + 1, h), P(k.x, k.y + 1, h)], `hsl(${hue},70%,62%)`);           // top, lightest
    }
  }
  animate_when_visible(canvas, frame);
  frame(performance.now(), 0.016);          // paint once right away, the visibility observer can take a moment

  seg($('#mode'), (b) => { mode = b.dataset.mode; });
  $('#hues').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', $('#hues')).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); hue0 = +b.dataset.hue; });
  slider($('#grid'), $('#grid_out'), (v) => { N = v; build(); });
}
init();
```
Swatches markup (base.css supplies `.swatches` and `.sw`, the color comes from the inline `--c`):
```html
<div class="swatches" id="hues" role="group" aria-label="Hue">
  <button class="sw" style="--c:#7a5cff" data-hue="255" aria-pressed="true" aria-label="Violet"></button>
  <button class="sw" style="--c:#25d0ff" data-hue="190" aria-pressed="false" aria-label="Cyan"></button>
  <button class="sw" style="--c:#ffab2b" data-hue="30" aria-pressed="false" aria-label="Amber"></button>
  <button class="sw" style="--c:#ff3d9a" data-hue="330" aria-pressed="false" aria-label="Pink"></button>
</div>
```
Optional per mode `accent` (how much hue shifts with height): waves 1, city .35, stairs .42. Set it in the seg callback. Optional extras that earn their place: a mono cell readout in the `.tag`, a faint vignette, a click ring (already in `height`).

## Controls
`seg` Waves / City / Stairs (`data-mode`), `swatches` of 4 hues (`data-hue`), slider Grid 6 to 16 with id `grid` and output `grid_out`.

## Pitfalls
- If blocks overlap wrongly the sort is wrong. Sort by `x + y`, ties do not matter.
- All three faces the same tone looks flat. The three tones are the whole effect.
- Front blocks cut off at the bottom: the layout must include `MAX_H`, as above. Never size by width alone.
- Hover bump that snaps in one frame: smooth `hx_s`, `hy_s` and `hover` with `damp`.
- First paint: the visibility observer can fire late, so call `frame()` once yourself at init.
- Do not allocate big arrays per block in the hot loop beyond the small point lists above. If the grid is 16 by 16 and the page feels slow, reduce to a shared point buffer.

## Done when
A diamond of 3 tone blocks fully inside the stage, a wave rolling through, the hovered cell rises as a smooth bump that never leaves the canvas, a click sends a ring outward, all three modes look different.

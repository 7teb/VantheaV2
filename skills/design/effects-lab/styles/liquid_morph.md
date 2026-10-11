# Liquid morph

Look: saturated blobs `#ff3d9a #7a5cff #25d0ff #3dffb0` on near black. Surfaces merge like mercury or lava. Optional glossy highlight.
Stage: two options. Use both side by side with the `.pair` grid (`grid-template-columns: 1fr 1fr; gap: 16px`, one column under 860px), each a `.stage` with height `min(62vh, 520px)`.

## A. Metaballs (SVG goo filter)
Technique: blur a layer of circles, then crush the alpha with a color matrix. Circles that touch fuse.
```html
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feGaussianBlur id="goo_blur" in="SourceGraphic" stdDeviation="12" result="b"/>
    <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/>
  </filter>
</svg>
<div class="stage" id="goo_stage"><div class="goo" id="goo_layer"></div></div>
```
```css
.goo { position: absolute; inset: 0; filter: url(#goo); }
.goo i { position: absolute; left: 0; top: 0; border-radius: 50%; will-change: transform; }
```
```js
const stage = $('#goo_stage'), layer = $('#goo_layer'), ptr = pointer_in(stage);
const colors = ['#ff3d9a', '#7a5cff', '#25d0ff', '#3dffb0', '#ffb23d', '#ff5c5c', '#b46bff'];
const make = (size, color) => {
  const el = document.createElement('i');
  el.style.cssText = `width:${size}px;height:${size}px;margin:${-size/2}px 0 0 ${-size/2}px;background:${color}`;
  layer.appendChild(el); return el;
};
const blobs = colors.map((col) => ({ el: make(rand(52, 100), col), ph: rand(0, 6.28), ph2: rand(0, 6.28),
  sx: rand(.35, .8), sy: rand(.3, .7), ax: rand(.25, .42), ay: rand(.22, .36), pull: 0 }));
const cur = { el: make(130, '#ffffff'), x: 0, y: 0 };      // blob that follows the pointer
animate_when_visible(stage, (t, dt) => {
  const w = stage.clientWidth, h = stage.clientHeight, s = t / 1000;
  const tx = ptr.inside ? ptr.x : w / 2 + Math.sin(s * .6) * w * .12;
  const ty = ptr.inside ? ptr.y : h / 2 + Math.cos(s * .5) * h * .1;
  cur.x = damp(cur.x || w / 2, tx, 7, dt); cur.y = damp(cur.y || h / 2, ty, 7, dt);
  cur.el.style.transform = `translate(${cur.x}px,${cur.y}px) scale(${ptr.down ? 1.5 : 1})`;
  blobs.forEach((b, i) => {
    b.pull = damp(b.pull, ptr.inside ? (i % 2 ? .3 : .18) : 0, 3, dt);
    const ox = w / 2 + Math.sin(s * b.sx + b.ph) * w * b.ax, oy = h / 2 + Math.cos(s * b.sy + b.ph2) * h * b.ay;
    b.el.style.transform = `translate(${lerp(ox, cur.x, b.pull)}px,${lerp(oy, cur.y, b.pull)}px)`;
  });
});
slider($('#goo_range'), $('#goo_out'), (v) => $('#goo_blur').setAttribute('stdDeviation', v));
```
Viscosity slider range 5 to 20. Higher means gooier.

## B. Morphing outline (closed Catmull-Rom spline)
```html
<svg id="morph" viewBox="-250 -250 500 500" style="position:absolute;inset:0;width:100%;height:100%">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3d9a"/><stop offset=".5" stop-color="#7a5cff"/><stop offset="1" stop-color="#25d0ff"/></linearGradient>
    <radialGradient id="mh" cx=".35" cy=".28" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <path id="morph_glow" fill="url(#mg)" style="filter:blur(34px);opacity:.55"/>
  <path id="morph_main" fill="url(#mg)"/>
  <path id="morph_gloss" fill="url(#mh)"/>
</svg>
```
```js
const N = 24, R = 165;
const shapes = {
  blob: (a) => .86 + .08 * Math.sin(a * 3 + 1) + .05 * Math.cos(a * 2),
  circle: () => .92,
  star: (a, i) => (i % 2 ? .5 : 1),
  flower: (a) => .72 + .27 * Math.cos(a * 6),
};
let shape = 'blob';
const pts = Array.from({ length: N }, () => ({ r: .9, pull: 0 }));
function path_d(q) {
  const n = q.length; let d = `M${q[0].x.toFixed(1)} ${q[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = q[(i - 1 + n) % n], p1 = q[i], p2 = q[(i + 1) % n], p3 = q[(i + 2) % n];
    d += `C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + 'Z';
}
```
Each frame: for point i, angle `a = i / N * TAU`, `p.r = damp(p.r, shapes[shape](a, i), 5, dt)`, radius `p.r * (1 + .045 * sin(s * 1.4 + i * 1.7)) * R`, rotate by `s * .18`. Convert the pointer to viewBox units (`(ptr.x - width/2) / k`, `k = min(width, height) / 500`). Points near the pointer get pulled toward it by `max(0, 1 - d / 200) * (down ? .75 : .45)`, smoothed with `damp`. Set the same `d` on all three paths.

## Controls
`seg` Blob / Circle / Star / Flower, slider Viscosity.

## Pitfalls
- Goo filter on a layer with a big blur but opaque stage background: keep the circles on a transparent layer.
- Blobs invisible: they need `left: 0; top: 0` and a transform, size with width and height.
- Do not put text inside the goo layer, it will melt.

## Done when
Blobs visibly fuse and split, the pointer blob drags neighbors toward it, the outline smoothly changes between 4 shapes and bulges toward the mouse.

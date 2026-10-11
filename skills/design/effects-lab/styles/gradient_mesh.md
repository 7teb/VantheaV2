# Gradient mesh

Look: soft flowing color fields with no visible shapes, silky transitions, fine film grain on top. Palettes of 4 to 5 related colors, one dark anchor.
- aurora: `#0b1020 #3a1c71 #d76d77 #ffaf7b #25d0ff`
- candy: `#1a0b2e #ff3d9a #7a5cff #25d0ff #ffe29a`
- ocean: `#04121c #0b5d8a #1fb6c9 #7ee8c0 #f3ffe9`
- ember: `#120606 #5e1010 #d6401f #ff9a3d #ffe3a3`
Stage: `.stage.h_lg` with two layers, Blobs (CSS) and Warp (canvas), one visible at a time. Grain on top of both.

## A. Blobs
Technique: 5 big radial gradient circles on a layer blurred by 60px, moving on lissajous paths, one follows the pointer.
```css
.mesh_blobs { position: absolute; inset: -12%; filter: blur(60px) saturate(1.5); }
/* Center a blob with translate(-50%, -50%) inside its transform. Percent margins resolve against the WIDTH, so they land high on a wide stage. */
.mesh_blobs i { position: absolute; left: 0; top: 0; width: 58%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle, var(--c) 0%, transparent 68%); will-change: transform; }
/* The blob layer is bigger than the stage (inset -12%). Take positions from the LAYER size, not the stage size:
   x = layer.clientWidth * (.5 + sin(...) * ax), then el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`. */
.grain { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: overlay; opacity: .35;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='1 1 1 0 -1  1 1 1 0 -1  1 1 1 0 -1  0 0 0 0 1'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>"); }
```
```js
const PALETTES = { aurora: ['#0b1020', '#3a1c71', '#d76d77', '#ffaf7b', '#25d0ff'], candy: ['#1a0b2e', '#ff3d9a', '#7a5cff', '#25d0ff', '#ffe29a'],
  ocean: ['#04121c', '#0b5d8a', '#1fb6c9', '#7ee8c0', '#f3ffe9'], ember: ['#120606', '#5e1010', '#d6401f', '#ff9a3d', '#ffe3a3'] };
let pal = PALETTES.aurora;
const blobs = $$('.mesh_blobs i').map((el, i) => ({ el, ph: rand(0, 6.28), ph2: rand(0, 6.28), sx: rand(.12, .3), sy: rand(.1, .26), ax: rand(.22, .4), ay: rand(.2, .36), pull: 0 }));
function paint_palette() { stage.style.background = pal[0]; blobs.forEach((b, i) => b.el.style.setProperty('--c', pal[1 + ((i + 2) % 4)])); }   // blob 0 gets pal[3], one of the bright colors, pal[1] is the darkest
// frame: position = center + sin(s * sx + ph) * w * ax, pointer pulls blob 0 with damp, speed slider multiplies s
```
Make blob 0 big and bright, so the pointer visibly drags a color.
Warp canvas: the visible canvas `#mesh_canvas` is 80x50 on purpose (CSS scales it up, `image-rendering: auto`). This is the one allowed exception to `fit_canvas`, because the low resolution is the technique. In Blobs mode hide it with `hidden`.

## B. Warp (true bilinear mesh with domain warping)
Technique: a 5 by 4 grid of node colors. For each pixel of a tiny canvas (80 by 50) warp the coordinate with sines, sample the grid with smoothstep bilinear interpolation. CSS scales the tiny canvas up, the browser smoothing makes it silky.
```js
const mc = $('#mesh_canvas'); mc.width = 80; mc.height = 50;
const mctx = mc.getContext('2d'), img = mctx.createImageData(80, 50);
const GW = 5, GH = 4;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sm = (t) => t * t * (3 - 2 * t);
function draw_mesh(s) {
  const nodes = []; for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) nodes.push(hex(pal[(i * 2 + j * 3 + Math.floor(s * .35)) % pal.length]));
  for (let y = 0; y < 50; y++) for (let x = 0; x < 80; x++) {
    let u = x / 79, v = y / 49;
    u = clamp(u + .09 * Math.sin(v * 5 + s * .8) + .05 * Math.sin(v * 11 - s * 1.1), 0, .9999); v = clamp(v + .09 * Math.sin(u * 4 - s * .7) + .05 * Math.cos(u * 9 + s), 0, .9999);
    const gx = u * (GW - 1), gy = v * (GH - 1), i = Math.floor(gx), j = Math.floor(gy), fx = sm(gx - i), fy = sm(gy - j);
    const a = nodes[j * GW + i], b = nodes[j * GW + i + 1], c = nodes[(j + 1) * GW + i], d = nodes[(j + 1) * GW + i + 1], o = (y * 80 + x) * 4;
    for (let k = 0; k < 3; k++) {
      const top = lerp(a[k], b[k], fx), bot = lerp(c[k], d[k], fx);
      img.data[o + k] = lerp(top, bot, fy);
    }
    img.data[o + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);
}
```
Canvas CSS: `position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: auto;`.
Warp mode colors change smoothly because nodes are re-picked slowly: instead blend from the previous palette. Simple option: pick `Math.floor(s * .35)` and crossfade by its fraction.

## Controls
`seg` Blobs / Warp, `swatches` for the 4 palettes (each swatch shows its brightest color), slider Speed, button Shuffle (re-roll blob phases).

## Pitfalls
- Hard edges mean blur is too low or gradients end in solid colors. Always end radial gradients in `transparent`.
- Muddy gray where complementary colors meet. Keep palettes analogous.
- No grain gives plastic banding on dark gradients. Always add the grain.
- The grain matrix must output real grayscale noise (`1 1 1 0 -1` per row, alpha forced to 1). A matrix that forces RGB to a constant 50 percent gray is a silent no-op under `overlay`.
- A canvas scaled with `image-rendering: pixelated` will look blocky. Leave it on `auto`.

## Done when
Color fields flow slowly with no visible shape edges, grain is visible up close, the pointer drags a color in Blobs, Warp looks like silk, palettes change the whole mood.

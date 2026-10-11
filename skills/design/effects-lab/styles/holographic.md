# Holographic

Look: dark card `#0a0a0e` to `#1b1b26`, iridescent foil `#ff4fd8 #ffd25a #5affc0 #4fb4ff #a266ff`, a hard white glare, fine dot grain. Think trading card foil.
Stage: `.stage.h_lg` with a card centered, or a row of 3 foils. A card is `aspect-ratio: 5 / 7`, width 320px, radius 20.

## Technique
1. The pointer position (0 to 1) drives CSS variables `--mx --my` (percent), `--rx --ry` (tilt degrees), `--o` (hover strength).
2. The foil is a wide gradient (300% size) whose `background-position` follows `--mx --my`. Blend it with `mix-blend-mode: screen`.
3. A radial glare follows the pointer with `mix-blend-mode: overlay`.
4. A dot grain layer is masked to a radius around the pointer.
5. The card tilts with `perspective(900px) rotateX() rotateY()`.
6. With no pointer, the light drifts on a slow ellipse so it is never static.

## Code
```html
<article class="holo" id="holo">
  <div class="holo_foil"></div><div class="holo_grain"></div>
  <svg class="holo_art" viewBox="0 0 200 200" aria-hidden="true"><!-- your line art, stroke rgba(255,255,255,.6) --></svg>
  <div class="holo_glare"></div>
</article>
```
```css
.holo { --mx: 50%; --my: 50%; --gx: 0; --gy: 0; --o: 0; --rx: 0deg; --ry: 0deg;
  position: relative; isolation: isolate; overflow: hidden; width: 320px; aspect-ratio: 5/7; border-radius: 20px;
  background: radial-gradient(120% 90% at 20% 0%, #1b1b26, #0a0a0e 62%);
  transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry));
  box-shadow: 0 30px 70px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08); will-change: transform; }
.holo_foil, .holo_grain, .holo_glare { position: absolute; inset: 0; pointer-events: none; }
.holo_foil { background: linear-gradient(115deg, #ff4fd8, #ffd25a, #5affc0, #4fb4ff, #a266ff, #ff4fd8, #ffd25a, #5affc0);
  background-size: 300% 300%; background-position: var(--mx) var(--my);
  mix-blend-mode: screen; opacity: calc(.42 + var(--o) * .32); filter: saturate(1.35) contrast(1.1); }
.holo_grain { background-image: radial-gradient(circle, #fff 0 1px, transparent 1.6px); background-size: 9px 9px;
  background-position: calc(var(--gx) * 18px) calc(var(--gy) * 18px); mix-blend-mode: overlay; opacity: .9;
  mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0, transparent 62%); -webkit-mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0, transparent 62%); }
.holo_glare { background: radial-gradient(farthest-corner circle at var(--mx) var(--my), rgba(255,255,255,.5), rgba(255,255,255,.06) 38%, transparent 62%);
  mix-blend-mode: overlay; opacity: calc(.45 + var(--o) * .55); }
.holo_art { position: absolute; inset: 14% 10% 20%; width: 80%; margin: auto; transform: translate(calc(var(--gx) * -6px), calc(var(--gy) * -6px)); }
```
```js
const el = $('#holo');
const cur = { x: .5, y: .5, o: 0 }, tgt = { x: .5, y: .5, o: 0 };
let hover = false;
el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); tgt.x = clamp((e.clientX - r.left) / r.width, 0, 1); tgt.y = clamp((e.clientY - r.top) / r.height, 0, 1); hover = true; });
el.addEventListener('pointerleave', () => { hover = false; });
animate_when_visible(el, (t, dt) => {
  const s = t / 1000;
  if (!hover) { tgt.x = .5 + Math.cos(s * .6) * .34; tgt.y = .5 + Math.sin(s * .45) * .34; }
  tgt.o = hover ? 1 : 0;
  cur.x = damp(cur.x, tgt.x, 8, dt); cur.y = damp(cur.y, tgt.y, 8, dt); cur.o = damp(cur.o, tgt.o, 5, dt);
  const tilt = 6 + cur.o * 9, st = el.style;
  st.setProperty('--mx', (cur.x * 100).toFixed(1) + '%'); st.setProperty('--my', (cur.y * 100).toFixed(1) + '%');
  st.setProperty('--gx', ((cur.x - .5) * 2).toFixed(3)); st.setProperty('--gy', ((cur.y - .5) * 2).toFixed(3));
  st.setProperty('--o', cur.o.toFixed(3));
  st.setProperty('--ry', ((cur.x - .5) * 2 * tilt).toFixed(2) + 'deg'); st.setProperty('--rx', (-(cur.y - .5) * 2 * tilt).toFixed(2) + 'deg');
});
```

## Foil variants (use as a `seg` that swaps a class on the card)
- stripe: foil gradient 90deg, 300% x 100%, masked with `repeating-linear-gradient(90deg, #000 0 3px, transparent 3px 7px)`.
- prism: `conic-gradient(from calc(var(--gx) * 120deg + 40deg) at var(--mx) var(--my), <rainbow>)`.
- halftone: mask `radial-gradient(circle, #000 0 2px, transparent 2.6px)` with `mask-size: 9px 9px`.

## Holographic text
Stack 3 copies of the word in a grid cell (`grid-area: 1 / 1`). Red copy `#ff2a6d` shifted -3px and cyan copy `#05d9ff` shifted +3px, both `mix-blend-mode: screen`. The top copy has the rainbow as `background-clip: text` and `background-position` animated. Add scanlines `repeating-linear-gradient(0deg, rgba(0,0,0,.4) 0 1px, transparent 1px 4px)` over the stage.

## Controls
`seg` Foil / Stripe / Prism / Halftone. Optional slider Tilt (3 to 20).

## Pitfalls
- Flat rainbow with no glare looks like a sticker. The glare is what sells it.
- The tilt must use `perspective()` inside the transform string, or it looks 2D.
- Do not set `overflow: visible` on the card, the layers will spill.

## Done when
Light and rainbow visibly slide across the card as the mouse moves, the card tilts, and with the mouse away the sheen keeps drifting.

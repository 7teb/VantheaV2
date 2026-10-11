# Particles

Look: near black stage `#030303`, additive glow, hues 185 to 330 (cyan through magenta). Soft trails. Nothing solid.
Stage: `<canvas class="fill" id="p_canvas">` inside `.stage.h_md`.

## Technique
1. Draw every frame with a translucent black rectangle instead of clearing. This makes trails.
2. Set `globalCompositeOperation = 'lighter'` before drawing dots and lines so overlaps glow.
3. Each particle gets a big faint circle (radius x3.4, alpha 0.1) and a small bright core.
4. The pointer pushes particles away (hover) or pulls (pressed).
5. Link lines between particles closer than 110px, alpha by distance.

## Code
```js
const canvas = $('#p_canvas');
const c = fit_canvas(canvas);
const ptr = pointer_in(canvas);
const parts = [];
let count = 140, mode = 'link';

const make = () => ({ x: rand(0, c.w), y: rand(0, c.h), vx: rand(-.5, .5), vy: rand(-.5, .5), r: rand(1, 2.5), hue: rand(185, 330) });
function resize_pool() { while (parts.length < count) parts.push(make()); parts.length = count; }
resize_pool();

animate_when_visible(canvas, () => {
  const ctx = c.ctx;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(3,3,3,0.4)';           // lower alpha = longer trails
  ctx.fillRect(0, 0, c.w, c.h);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    if (ptr.inside) {
      const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
      if (d2 < 22500 && d2 > 1) { const d = Math.sqrt(d2), f = (1 - d / 150) * (ptr.down ? -0.7 : 0.5); p.vx += dx / d * f; p.vy += dy / d * f; }
    }
    p.vx *= 0.99; p.vy *= 0.99;
    const s = Math.hypot(p.vx, p.vy);
    if (s < 0.25) { p.vx += 0.02 * Math.sign(p.vx || 1); p.vy += 0.02 * Math.sign(p.vy || 1); }  // never stop
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > c.w) { p.vx *= -1; p.x = clamp(p.x, 0, c.w); }
    if (p.y < 0 || p.y > c.h) { p.vy *= -1; p.y = clamp(p.y, 0, c.h); }
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i];
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 12100) {
        ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2},90%,68%,${(1 - Math.sqrt(d2) / 110) * 0.5})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }
  for (const p of parts) {
    ctx.fillStyle = `hsla(${p.hue},95%,68%,0.1)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = `hsla(${p.hue},95%,74%,0.95)`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
});
```
The line loop is O(n squared). Keep `count` at 320 or less.

## More modes (add 2 as a `seg` control)
- swirl: pull toward pointer (or stage center) plus a tangent force `(-dy, dx)`. Trail alpha 0.13. Color by speed: `hue = 190 + speed * 28`. Respawn particles that leave the stage.
- gravity: `vy += 0.15`, bounce on the floor with `vy *= -0.78`, pressed pointer attracts, hover repels. Trail alpha 0.28. No link lines.

## Controls
`seg` Link / Swirl / Gravity, slider Count 20 to 320.

## Pitfalls
- Particles stuck in a corner after resize: clamp positions in `onresize`.
- Lines drawn with `source-over` look flat, keep `lighter`.

## Done when
Trails are visible, links glow where particles overlap, moving the mouse visibly pushes particles, all three modes look different.

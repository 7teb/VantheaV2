# Neon glow

Look: stage `#040404`. Two neon colors per theme (default `#ff2bd6` and `#25e3ff`). Glass tube look: a white hot core, the color around it, then wide soft halos. A faint colored fog on the stage.
Stage: `.stage.h_lg`, a centered sign, an animated wave, a boxed word, a ring.

## Technique
1. One CSS variable `--g` (0 to 2) multiplies every glow radius. A slider on `--g` gives intensity.
2. Text: color is the neon color mixed 80 percent with white. `text-shadow` is a stack of 5 shadows growing from 2px white to 90px color.
3. Shapes: `box-shadow` with both outer and `inset` glow plus a 3px inset ring in the color.
4. SVG lines: two strokes. Wide colored tube (width 5), narrow white core (width 1.6), and `drop-shadow` filters on the group.
5. Flicker: only one or two letters flicker, with long irregular keyframes. Never the whole sign.
6. Stage fog: two `radial-gradient`s with `color-mix(in srgb, var(--neon) 16%, transparent)`.

## Code
```css
.neon { --neon: #ff2bd6; --neon2: #25e3ff; --g: 1; background: #040404; }
.neon::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(60% 55% at 30% 20%, color-mix(in srgb, var(--neon) 16%, transparent), transparent),
              radial-gradient(55% 50% at 75% 75%, color-mix(in srgb, var(--neon2) 13%, transparent), transparent); }
.n_line { display: block; font-size: clamp(56px, 11vw, 136px); font-weight: 700; letter-spacing: .02em; line-height: 1.1;
  color: color-mix(in srgb, var(--c) 16%, #fff);
  text-shadow: 0 0 calc(2px * var(--g)) #fff, 0 0 calc(8px * var(--g)) var(--c), 0 0 calc(22px * var(--g)) var(--c),
               0 0 calc(48px * var(--g)) var(--c), 0 0 calc(90px * var(--g)) var(--c); }
.n_line.a { --c: var(--neon); } .n_line.b { --c: var(--neon2); }
.flick { animation: flick 5s infinite; }
@keyframes flick { 0%,19%,21%,23%,25%,54%,56%,100% { opacity: 1; } 20%,24%,55% { opacity: .22; } }
.sign_box { padding: 12px 30px 12px 36px; border-radius: 16px; font-size: 28px; font-weight: 700; letter-spacing: .32em;
  color: color-mix(in srgb, var(--neon) 20%, #fff);
  text-shadow: 0 0 calc(3px * var(--g)) #fff, 0 0 calc(12px * var(--g)) var(--neon), 0 0 calc(30px * var(--g)) var(--neon);
  box-shadow: inset 0 0 0 3px var(--neon), 0 0 calc(4px * var(--g)) var(--neon), 0 0 calc(22px * var(--g)) var(--neon), inset 0 0 calc(18px * var(--g)) var(--neon); }
.tube { stroke: var(--c); stroke-width: 5; fill: none; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.core { stroke: #fff; stroke-width: 1.6; fill: none; opacity: .85; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.w { filter: drop-shadow(0 0 calc(5px * var(--g)) var(--c)) drop-shadow(0 0 calc(16px * var(--g)) var(--c)); }
@property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.halo { position: relative; width: 128px; height: 128px; border-radius: 50%;
  box-shadow: inset 0 0 0 3px var(--neon2), 0 0 calc(22px * var(--g)) var(--neon2), inset 0 0 calc(18px * var(--g)) var(--neon2); }
.halo::after { content: ''; position: absolute; inset: 16px; border-radius: 50%;
  background: conic-gradient(from var(--a), transparent 0 55%, var(--neon) 100%);
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
  animation: spin_a 2.4s linear infinite; }
@keyframes spin_a { to { --a: 360deg; } }
```
Wave path in JS, each frame, for `x` from 0 to 800 step 6: `y = 60 + amp * sin(x / 800 * PI) * sin(x * f * 6 + s * speed * 2 + phase)`. Set the same `d` on the `.tube` and `.core` path. Use two waves with different amp, f, speed, phase.

Theme swatches set `--neon` and `--neon2` on the stage. Power button adds `.is-off` which sets `filter: brightness(.1) saturate(.3)` on the scene, turning back on plays a 0.9s keyframe that flickers opacity.

## Controls
`swatches` 5 color pairs, slider Intensity 0 to 200 (sets `--g`), toggles Pulse (keyframe `filter: brightness(1.4)` at 50 percent, 2.2s), Flicker, Power.

## Pitfalls
- Glow only works on dark. Never place neon on a light surface.
- Do not use `filter: blur` on the text, use text-shadow, it stays crisp.
- A pure saturated text color looks flat. Mix it toward white for the core.
- Too many glowing things is noise. Keep 4 or 5 elements.

## Done when
There is a hot white core with colored halos, one letter flickers now and then, the wave undulates, swatches recolor everything, Intensity visibly widens the glow.

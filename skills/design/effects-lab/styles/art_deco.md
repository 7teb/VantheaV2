# Art deco

Look: 1920s luxury. Deep emerald or black `#07120e`, gold `#d4af37 / #f0d78c / #8a6a1f`, ivory `#f4ecd8`. Symmetry, sunburst fans, concentric arcs, stepped (ziggurat) corners, diamond lattices, thin double gold lines, wide tracked capitals. Type: `Poiret One` for display and `Josefin Sans` for small caps (add `family=Poiret+One&family=Josefin+Sans:wght@400;600` to the fonts URL, fallback `'Century Gothic', Futura, sans-serif`).
Stage: `.stage.h_lg` with a deep green radial background. Everything is centered on one vertical axis.

## Technique
1. Theme vars on the stage: `--bgd`, `--g1`, `--g2`, `--g3` (light, mid, dark gold) so a seg swaps the whole palette.
2. Sunburst: a half disc at the bottom center using `repeating-conic-gradient(from -90deg at 50% 100%, ...)` and a radial mask. Rays rotate slowly by animating a `@property` angle.
3. Concentric arcs over the fan with `repeating-radial-gradient(circle at 50% 100%, ...)`.
4. Frame: stepped corners from `clip-path: polygon(...)`. Two nested frames (outer gold, inner dark) make a double line.
5. Lattice: two crossing `repeating-linear-gradient` layers (45 and 135 degrees) make diamonds in the side pillars.
6. Title: gold gradient clipped to text with a shimmer sweep. Letter spacing .3em, uppercase.
7. Pointer parallax: three layers move by 6, 12, 20px against the pointer, smoothed with `damp`. A gold glare follows the pointer inside the fan.

## Code
```css
.deco { --bgd: #07120e; --g0: #fff8dc; --g1: #f0d78c; --g2: #d4af37; --g3: #8a6a1f; --ray: 3deg; --mx: 50%; --my: 72%;
  background: radial-gradient(90% 80% at 50% 100%, rgba(255,232,170,.08), transparent 70%), var(--bgd); }     /* warm tint, not a hardcoded green, so every theme works */
.deco .tag { left: 62px; top: 44px; bottom: auto; }       /* the base tag sits on the gold frame band, move it inside the poster */
@property --ang { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.fan { position: absolute; left: 50%; bottom: 0; width: min(92%, 980px); aspect-ratio: 2 / 1; transform: translateX(-50%);
  background: repeating-conic-gradient(from calc(-90deg + var(--ang)) at 50% 100%, var(--g2) 0 var(--ray, 3deg), transparent var(--ray, 3deg) calc(var(--ray, 3deg) * 3));
  mask-image: radial-gradient(circle at 50% 100%, #000 0 62%, transparent 62.4%); -webkit-mask-image: radial-gradient(circle at 50% 100%, #000 0 62%, transparent 62.4%);
  opacity: .8; animation: fan_spin 80s linear infinite; }
@keyframes fan_spin { to { --ang: 360deg; } }
.arcs { position: absolute; left: 50%; bottom: 0; width: min(92%, 980px); aspect-ratio: 2 / 1; transform: translateX(-50%);
  background: repeating-radial-gradient(circle at 50% 100%, transparent 0 22px, var(--g1) 22px 24px, transparent 24px 46px);
  mask-image: radial-gradient(circle at 50% 100%, #000 0 62%, transparent 62.4%); -webkit-mask-image: radial-gradient(circle at 50% 100%, #000 0 62%, transparent 62.4%); opacity: .55; }
.glare { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light; background: radial-gradient(260px circle at var(--mx, 50%) var(--my, 70%), rgba(255,236,170,.55), transparent 70%); }
/* FRAME. Opaque layers stack, so the order matters: .frame, .frame.inner, .frame.line, .frame.core, then .poster.
   .frame.core is the opaque dark interior plate (NOT transparent). All the artwork (fan, arcs, scrim, pillars, title) lives inside .poster,
   which has the same inset and the same stepped clip, so nothing can spill over the gold border. */
.frame, .poster { position: absolute;
  clip-path: polygon(0 var(--n), var(--n) var(--n), var(--n) 0, calc(100% - var(--n)) 0, calc(100% - var(--n)) var(--n), 100% var(--n), 100% calc(100% - var(--n)), calc(100% - var(--n)) calc(100% - var(--n)), calc(100% - var(--n)) 100%, var(--n) 100%, var(--n) calc(100% - var(--n)), 0 calc(100% - var(--n))); }
.frame { --n: 30px; inset: 22px; background: var(--g2); pointer-events: none; }
.frame.inner { --n: 26px; inset: 28px; background: var(--bgd); }
.frame.line { --n: 22px; inset: 34px; background: var(--g1); }
.frame.core { --n: 20px; inset: 36px; background: radial-gradient(90% 80% at 50% 100%, rgba(255,232,170,.07), transparent 70%), var(--bgd); }
.poster { --n: 20px; inset: 36px; overflow: hidden; isolation: isolate; }
/* The fan reaches far up and would sit under the title. A soft dark plaque keeps the title and caption readable. Place it between .arcs and .pillar. */
.scrim { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(46% 30% at 50% 33%, rgba(0,0,0,.66), rgba(0,0,0,.52) 55%, transparent 100%); }
.pillar { position: absolute; top: 80px; bottom: 80px; width: clamp(26px, 9%, 70px); opacity: .8;
  background: repeating-linear-gradient(45deg, transparent 0 14px, var(--g2) 14px 15.5px), repeating-linear-gradient(135deg, transparent 0 14px, var(--g2) 14px 15.5px);
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent); -webkit-mask-image: linear-gradient(180deg, transparent, #000 12%, #000 88%, transparent); }
.pillar.l { left: 70px; } .pillar.r { right: 70px; }
.deco_title { position: absolute; left: 0; right: 0; top: 17%; text-align: center; font: 400 clamp(42px, 8vw, 104px)/1 'Poiret One', 'Century Gothic', Futura, sans-serif; letter-spacing: .3em; text-transform: uppercase; padding-left: .3em;
  color: transparent; background: linear-gradient(100deg, var(--g3) 0%, var(--g1) 30%, var(--g0) 50%, var(--g1) 70%, var(--g3) 100%); background-size: 250% 100%; -webkit-background-clip: text; background-clip: text; animation: shimmer 6s linear infinite; }
@keyframes shimmer { to { background-position: -250% 0; } }
.deco_sub { position: absolute; left: 0; right: 0; top: calc(17% + clamp(60px, 10vw, 130px)); text-align: center; font: 600 13px 'Josefin Sans', Futura, sans-serif; letter-spacing: .5em; text-transform: uppercase; color: var(--g1); padding-left: .5em; }
.rule { position: absolute; left: 50%; top: calc(17% + clamp(60px, 10vw, 130px) + 34px); width: 160px; height: 1px; transform: translateX(-50%); background: linear-gradient(90deg, transparent, var(--g2), transparent); }
```
```js
const stage = $('#stage'), ptr = pointer_in(stage);
const layers = [{ el: $('.fan'), k: 6 }, { el: $('.arcs'), k: 12 }, { el: $('.deco_title'), k: 20 }].map((l) => ({ ...l, x: 0, y: 0 }));
animate_when_visible(stage, (t, dt) => {
  const nx = ptr.inside ? ptr.nx - .5 : Math.sin(t / 3000) * .25, ny = ptr.inside ? ptr.ny - .5 : 0;
  layers.forEach((l) => {
    l.x = damp(l.x, -nx * l.k, 6, dt); l.y = damp(l.y, -ny * l.k, 6, dt);
    l.el.style.translate = `${l.x.toFixed(1)}px ${l.y.toFixed(1)}px`;
  });
  stage.style.setProperty('--mx', (ptr.inside ? ptr.nx * 100 : 50 + Math.sin(t / 2500) * 25) + '%');
  stage.style.setProperty('--my', (ptr.inside ? ptr.ny * 100 : 72) + '%');
});
const THEMES = {
  gold: { '--bgd': '#07120e', '--g0': '#fff8dc', '--g1': '#f0d78c', '--g2': '#d4af37', '--g3': '#8a6a1f' },
emerald: { '--bgd': '#04110d', '--g0': '#e6fff3', '--g1': '#b8f2d6', '--g2': '#3fbf8f', '--g3': '#14684a' },
rose: { '--bgd': '#160a10', '--g0': '#fff0ec', '--g1': '#ffd9d0', '--g2': '#e0907f', '--g3': '#8a4a47' },
};
seg($('#theme'), (b) => Object.entries(THEMES[b.dataset.theme]).forEach(([k, v]) => stage.style.setProperty(k, v)));
slider($('#ray'), $('#ray_out'), (v) => stage.style.setProperty('--ray', v + 'deg'));
```
`translate` is used for parallax (separate from the `translateX(-50%)` in `transform`), so both compose. The title is positioned with left 0 and right 0, so it needs no centering transform.

## Controls
`seg` Gold / Emerald / Rose, slider Ray width 1 to 6 (degrees, shown as the number).

Markup order inside `.deco`: `.frame`, `.frame.inner`, `.frame.line`, `.frame.core`, then `<div class="poster">` holding `.fan`, `.arcs`, `.scrim`, `.pillar.l`, `.pillar.r`, `.glare`, `.deco_title`, `.deco_sub`, `.rule`, and the `<span class="tag">` caption.
Use a generic title such as a single word and a year. No invented brand or real company names.

## Pitfalls
- Asymmetry breaks it. Everything mirrors around the center line.
- Rounded corners are not deco. Use steps and straight lines.
- Using yellow instead of metal gold. Gold is a 3 stop gradient (light, mid, dark), never a flat `#ffd700`.
- Title letter spacing adds trailing space, compensate with equal `padding-left` or the word sits off center.
- Missing fallback fonts. The stack must still look right in Futura or Century Gothic.

## Done when
A symmetrical gold on emerald poster: rotating fan with arcs, stepped double frame, lattice pillars, shimmering title, the pointer shifts layers and moves a warm glare, the theme seg recolors everything.

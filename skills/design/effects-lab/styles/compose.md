# Compose: one short ad from 2 or 3 effects

You are not building a style page. You are making a small 10 to 16 second ad that tells one story. Several effect styles each play ONE part of the same scene, share one palette, and move through scenes.

Use `python "SKILL_DIR/tools/scaffold.py" compose OUT` to start (SKILL_DIR is the skill folder from read_skill, see SKILL.md). It creates `index.html` (the ad template), `base.css`, `ad.css`, `helpers.js` and stubs.

## Step 1. Write `OUT/brief.md` BEFORE any code

Exactly these lines, one per line, in this order. check.py reads this file and checks your page against it.

```
subject: Night market lanterns
mood: warm, slow, a little mysterious
palette: c1 #12080a, c2 #ff7a3d, c3 #ffd166, c4 #ef476f, c5 #fff4e6
layers: gradient_mesh as background; liquid_morph as hero; kinetic_type as headline
kicker: Open after dark
headline: Light the night
sub: Lanterns, noodles and slow music until late.
cta: See the market
scene 1: arrive, mesh drifts in, headline appears (4s)
scene 2: energy, goo blobs swell, sub line appears (5s)
scene 3: settle, call to action appears (4s)
```

Rules for each line:
- `subject`: from the task. If the task gives none, pick a generic thing (a coffee roaster, a synth, a night market). Use the generic noun. NEVER invent a brand name, a logo, a person, a price, a percentage, a review or a claim like "best" or "free".
- `mood`: three adjectives. They decide the palette and the speed.
- `palette`: five hex colors named c1 to c5. c1 is the dark background (or a light one if clay_3d is a layer), c2 is the main accent, c3 and c4 are secondary accents, c5 is the text color. Take one of the five ready palettes below, or derive yours from them. Do not invent random colors.
- `layers`: 2 or 3 entries `style as role`, separated by `;`. Allowed styles and roles are in the table below. At most one hero, at most one headline, no style twice. You need a hero or a headline.
- Copy, four lines, nothing else: `kicker` up to 3 words. `headline` up to 6 words, a short phrase with a verb, no exclamation marks. `sub` up to 14 words, one sentence. `cta` up to 3 words, starts with a verb. No em dashes, no emoji, no numbers that look like facts.
- Scenes: 2 to 4 lines `scene N: what changes (Ns)`. In the brief the scenes count from 1, in the code (`data-show`, `data-scene`, `tl.index`) they count from 0. So brief scene 1 is `data-show="0"`. Each scene is 2 to 7 seconds. All scenes together are 16 seconds or less. A scene must CHANGE something: a slot appears, a layer gets more intense, the camera moves. Three scenes is the sweet spot: hook, energy, call to action.

### Ready palettes (pick one)
| mood | c1 | c2 | c3 | c4 | c5 |
|---|---|---|---|---|---|
| warm night | #12080a | #ff7a3d | #ffd166 | #ef476f | #fff4e6 |
| cold tech | #060912 | #25d0ff | #7a5cff | #3dffb0 | #eaf6ff |
| candy | #14081e | #ff3d9a | #7a5cff | #ffd166 | #fff0f7 |
| forest | #06100c | #3dffb0 | #b6ff2b | #25d0ff | #ecfff4 |
| gold | #0a0a0c | #f0d78c | #d4af37 | #ff7a3d | #fffaf0 |

## Step 2. Styles, roles, and how to lift them

Only the 13 EFFECT styles can be composed. The 7 WORLD styles (comic_book, split_flap, pixel_art, bauhaus, art_deco, neo_brutalism, blueprint) each own a whole look and cannot be mixed. Build those as single style pages. check.py fails a brief that lists a world.

| style | allowed roles | what it gives | lift from its card |
|---|---|---|---|
| gradient_mesh | background | slow flowing color fields | the Blobs part (the code below is ready) |
| particles | background, overlay | drifting glowing dots | the code below is ready |
| ascii_art | background | text characters as a texture | the plasma field only, dim it to 25 percent opacity |
| isometric | background, hero | block field | the whole card, shrink to one cluster, fewer cells (N = 8) |
| halftone | background, overlay | printed dots | the CSS dot mask version: `radial-gradient(circle, var(--c3) 28%, transparent 30%) 0 0 / 14px 14px` masked with a gradient. Do not use the canvas version, it is heavy |
| liquid_morph | hero, background | merging blobs | the code below is ready (metaballs) |
| holographic | hero, headline | tilting iridescent foil card, foil text | the card or the text. Foil colors become c2, c3, c4, the white glare and grain become `color-mix(in srgb, var(--c5) 50%, transparent)`, the card body is c1. Position the card with `left`/`top` in percent and `transform: translate(-50%, -50%) perspective(900px) rotateX(var(--rx)) rotateY(var(--ry))` (the centering has to be in the SAME transform as the tilt). Put it in `#layers_mid` |
| wireframe_3d | hero | rotating wire mesh | the whole card, but DELETE the floor grid loop. Keep the depth fade, replacing the `hsla(...)` hue with `pal[1]` for near lines and `pal[2]` for far lines (set `ctx.globalAlpha` by depth instead). One mesh only (torus). Auto rotate only, no drag. Put it in `#layers_mid`, a canvas sized with `fit_canvas`, mesh centered at `cx`, `cy` of the ad |
| clay_3d | hero | soft pastel objects | needs a LIGHT c1, 2 or 3 objects only |
| neon_glow | headline, hero | glowing text | the CSS only recipe below is ready |
| kinetic_type | headline | letters that wave and change weight | the code below is ready |
| glassmorphism | panel | frosted plate behind the copy | add class `glass_copy` to `#copy`, ad.css does the rest. Needs colorful layers behind it |
| retro_vhs | overlay | grain, scanlines, vignette | the code below is ready (`layer_retro_vhs`) |

### Where each layer goes (three hosts in the template)
- `#layers` for backgrounds (`gradient_mesh`, `particles`, `ascii_art`, `isometric` as background, `halftone`). The scrim dims them where the copy sits.
- `#layers_mid` for a hero that must stay bright and unscrimmed (`holographic`, `wireframe_3d`, `clay_3d`, `liquid_morph`, `isometric` as hero). It sits above the scrim and below the copy. With `data-layout="left"` the scrim hardly touches the right side, so `#layers` is also fine for a hero there. With `center` or `bottom` use `#layers_mid`.
- `#layers_top` for overlays (`retro_vhs`, a grain). It sits above everything, including the text.
Pass the right host to the layer function: `layer_retro_vhs($('#layers_top'), pal)`. The hosts are all exactly the size of the ad. The class `.goo` filter, canvases and `cqw` sizes work the same in all three.

### The layer contract (every layer follows it)
A JS layer is a function named `layer_<style>(host, pal)` that adds its element to `host` (one of the three hosts above) and returns an object with a `frame(t, dt, env)` method. The ONE exception is `layer_kinetic_type(el)`: it takes the headline element (`$('.slot_headline')`), not a host, because the headline is real text in the copy. Put your lifted functions at the top level of `app.js`, above `init()`. Always call `palette(ad)` with the ad element (it also works without an argument, but be explicit). `env.ptr` is the pointer state over the ad, `env.tl` is the timeline. Use `env.tl.mood` (0 calm to 1 intense, it eases between scenes) to make the layer more intense in the energetic scene. `pal` is the array from `palette()`: `pal[0]` is c1 (dark), `pal[1]` c2, `pal[2]` c3, `pal[3]` c4, `pal[4]` c5 (text). Layers use only `pal`, never their own colors. A CSS only layer needs no function, but write a comment `/* <style> */` before its rules so check.py can see it.

Working layers, copy them into `app.js` and delete the ones you do not use.

```js
/* layer_gradient_mesh : background. Four blurred color blobs on slow paths. Mood speeds the flow. */
function layer_gradient_mesh(host, pal) {
  const el = document.createElement('div'); el.className = 'layer mesh'; host.appendChild(el);
  const blobs = [1, 2, 3, 2].map((k, i) => {
    const b = document.createElement('i'); b.style.setProperty('--c', pal[k]); el.appendChild(b);
    return { b, ph: i * 1.7, ph2: i * 2.3, sx: .13 + i * .04, sy: .11 + i * .03 };
  });
  let s = 0;
  return { frame(t, dt, env) {
    s += dt * (.6 + env.tl.mood * 1.6);
    const w = el.clientWidth, h = el.clientHeight, grow = 1 + env.tl.mood * .25;
    blobs.forEach((o) => {
      const x = w * (.5 + Math.sin(s * o.sx + o.ph) * .34), y = h * (.5 + Math.cos(s * o.sy + o.ph2) * .3);
      o.b.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${grow.toFixed(3)})`;
    });
  } };
}

/* layer_particles : background or overlay. Glowing dots that drift, flee the pointer, speed up with mood. */
function layer_particles(host, pal) {
  const canvas = document.createElement('canvas'); canvas.className = 'layer'; host.appendChild(canvas);
  const c = fit_canvas(canvas);
  const ps = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), vx: rand(-1, 1), vy: rand(-1, 1), r: rand(.8, 2.2), k: 1 + ((Math.random() * 3) | 0) }));
  return { frame(t, dt, env) {
    const ctx = c.ctx, ptr = env.ptr, sp = 10 + env.tl.mood * 36;
    ctx.clearRect(0, 0, c.w, c.h); ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      p.x += p.vx * sp * dt / c.w; p.y += p.vy * sp * dt / c.h;
      if (p.x < 0 || p.x > 1) p.vx *= -1;
      if (p.y < 0 || p.y > 1) p.vy *= -1;
      p.x = clamp(p.x, 0, 1); p.y = clamp(p.y, 0, 1);
      const px = p.x * c.w, py = p.y * c.h;
      if (ptr.inside) {
        const dx = px - ptr.x, dy = py - ptr.y, d = Math.hypot(dx, dy) || 1;
        if (d < 140) { p.x += dx / d * (1 - d / 140) * 3 / c.w; p.y += dy / d * (1 - d / 140) * 3 / c.h; }
      }
      ctx.fillStyle = pal[p.k];
      ctx.globalAlpha = .14; ctx.beginPath(); ctx.arc(px, py, p.r * 4, 0, TAU); ctx.fill();
      ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(px, py, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  } };
}

/* layer_liquid_morph : hero. Metaballs (SVG goo). They gather and swell with mood and lean toward the pointer. */
function layer_liquid_morph(host, pal, opt = {}) {
  const cx = opt.cx ?? .7, cy = opt.cy ?? .5;                       // where the cluster lives, as a fraction of the ad
  if (!$('#goo_c')) host.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="goo_c" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="12" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter></svg>');
  const el = document.createElement('div'); el.className = 'layer goo'; host.appendChild(el);
  const blobs = Array.from({ length: 6 }, (_, i) => {
    const b = document.createElement('i'), s = rand(9, 17);
    b.style.cssText = `width:${s}cqw;height:${s}cqw;margin:${-s / 2}cqw 0 0 ${-s / 2}cqw;background:${pal[1 + (i % 3)]}`;
    el.appendChild(b);
    return { b, ph: rand(0, 6.28), ph2: rand(0, 6.28), sx: rand(.35, .8), sy: rand(.3, .7) };
  });
  let s = 0, px = 0, py = 0;
  return { frame(t, dt, env) {
    const w = el.clientWidth, h = el.clientHeight, m = env.tl.mood;
    s += dt * (.7 + m * 1.2);
    const spread = (.08 + m * .08) * Math.min(w, h);                // wider swing when the mood is high. Keep it small, cx + spread must stay inside the ad (cx .72 leaves .28 of the width)
    const lean = env.ptr.inside ? (env.ptr.x - w * cx) * .08 : 0;
    px = damp(px, lean, 4, dt); py = damp(py, env.ptr.inside ? (env.ptr.y - h * cy) * .08 : 0, 4, dt);
    blobs.forEach((o, i) => {
      const x = w * cx + px + Math.sin(s * o.sx + o.ph) * spread * 1.6, y = h * cy + py + Math.cos(s * o.sy + o.ph2) * spread;
      o.b.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${(1 + m * .35).toFixed(3)})`;
    });
  } };
}

/* layer_kinetic_type : headline. Splits the headline into letters. They wave and change weight, more with mood. el is the .slot_headline element. */
function layer_kinetic_type(el) {
  const text = el.textContent.trim(); el.textContent = ''; el.setAttribute('aria-label', text);
  const chars = [];
  [...text].forEach((ch) => {
    if (ch === ' ') { el.appendChild(document.createTextNode(' ')); return; }
    const s = document.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true'); s.textContent = ch; el.appendChild(s); chars.push(s);
  });
  let s = 0;
  return { frame(t, dt, env) {
    s += dt * (1.2 + env.tl.mood * 2.4);
    chars.forEach((c, i) => {
      const w = Math.sin(s * 2 + i * .55), m = env.tl.mood;
      c.style.transform = `translateY(${(w * m * .1).toFixed(3)}em)`;
      c.style.fontVariationSettings = `'wght' ${Math.round(640 + 220 * w * (.35 + m))}`;
    });
  } };
}

/* layer_retro_vhs : overlay. Film grain, scanlines and a vignette on top of everything. CSS only, the grain drifts a little with mood. */
function layer_retro_vhs(host) {
  const grain = document.createElement('div'); grain.className = 'layer grain'; host.appendChild(grain);
  ['scan', 'vig'].forEach((k) => { const d = document.createElement('div'); d.className = 'layer ' + k; host.appendChild(d); });
  return { frame(t, dt, env) { grain.style.transform = `translate(${((t / 40) % 160).toFixed(1)}px, ${((t / 55) % 160).toFixed(1)}px)`; grain.style.opacity = (.28 + env.tl.mood * .2).toFixed(2); } };
}
```

CSS for those layers. Copy into `styles.css`:
```css
/* gradient_mesh */
.mesh { inset: -15%; width: auto; height: auto; filter: blur(70px) saturate(1.4); }
.mesh i { position: absolute; left: 0; top: 0; width: 55%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, var(--c), transparent 68%); will-change: transform; }
/* liquid_morph */
.goo { filter: url(#goo_c); }
.goo i { position: absolute; left: 0; top: 0; border-radius: 50%; will-change: transform; }
/* kinetic_type */
.ch { display: inline-block; font-variation-settings: 'wght' 700; will-change: transform; }
/* retro_vhs (overlay: grain, scanlines, vignette) */
.grain { inset: -160px; width: auto; height: auto; mix-blend-mode: overlay; opacity: .35;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='1 1 1 0 -1  1 1 1 0 -1  1 1 1 0 -1  0 0 0 0 1'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>"); }
.scan { background: repeating-linear-gradient(0deg, rgba(0, 0, 0, .22) 0 1px, transparent 1px 3px); }
.vig { background: radial-gradient(120% 120% at 50% 50%, transparent 55%, rgba(0, 0, 0, .6)); }
```

Neon headline (CSS only, role headline or hero for neon_glow). Put the comment, give the headline slot the class `headline_neon`. The glow grows with the scene mood because the timeline sets `--mood` on the ad:
```css
/* neon_glow */
.headline_neon { color: color-mix(in srgb, var(--c2) 18%, #fff);
  text-shadow: 0 0 .02em #fff, 0 0 calc(.08em + var(--mood, 0) * .06em) var(--c2), 0 0 calc(.26em + var(--mood, 0) * .16em) var(--c2), 0 0 calc(.6em + var(--mood, 0) * .3em) var(--c2); }
```

Ready made above: gradient_mesh, particles, liquid_morph, kinetic_type, retro_vhs, plus the CSS only neon_glow and glassmorphism. Any style that is not written out (isometric, holographic, wireframe_3d, clay_3d, ascii_art, halftone): copy the code from its own card into a function `layer_<style>(host, pal)` with these changes. Create its element with class `layer` inside `host`. Use `fit_canvas` for canvases. Replace every hard coded color with `pal[...]`. Move the per frame code into `frame(t, dt, env)`, use `env.ptr` instead of your own `pointer_in`, and multiply one speed or amount by something like `(0.6 + env.tl.mood)`. Remove the style's own controls. Keep it small.

## Step 3. Palette in `styles.css`
Set the five colors on `.ad`. This is also what `palette()` reads.
```css
.ad { --c1: #12080a; --c2: #ff7a3d; --c3: #ffd166; --c4: #ef476f; --c5: #fff4e6; }
```
Keep `ad.css` before `styles.css` in `index.html` (the template already does).

## Step 4. `app.js`
```js
function init() {
  const ad = $('#ad'), host = $('#layers'), mid = $('#layers_mid'), top = $('#layers_top'), ptr = pointer_in(ad), pal = palette(ad);
  // 1. scenes. dur is seconds, mood is 0 calm to 1 intense. The dots control is the #scenes seg.
  const tl = timeline(ad, [
    { dur: 4, mood: .25 },
    { dur: 5, mood: 1 },
    { dur: 4, mood: .5 },
  ], { dots: $('#scenes') });
  // 2. layers, back to front. The order here is the stacking order.
  const layers = [
    layer_gradient_mesh(host, pal),
    layer_liquid_morph(mid, pal, { cx: .72 }),          // hero: mid host. Overlays would use top.
    layer_kinetic_type($('.slot_headline')),
  ];
  // 3. one loop for all layers
  const env = { ptr, tl };
  function frame(t, dt) { layers.forEach((l) => l.frame(t, dt, env)); }
  animate_when_visible(ad, frame);
  frame(performance.now(), 0.016);
  // 4. controls
  seg($('#format'), (b) => { ad.dataset.format = b.dataset.format; });
  $('#replay').addEventListener('click', () => tl.restart());
}
init();
```
The headline layer works on a DOM element, so list it last or anywhere, it does not stack. Layout: `data-layout="left"` puts the copy on the left, so put the hero on the right (`cx: .72`). With `center` put the hero behind the text and keep its mood low. With `bottom` put the hero in the upper half (`cy: .35`).
The hero must never touch the ad border: the cluster half width is about `9cqw + spread`, so keep `cx` between .25 and .72 and `cy` between .3 and .7 for a goo or wire hero. In the 9:16 format the width is small, so also set `cx: .5` in `@container`-free code by reading `ad.dataset.format` in the frame (`const portrait = ad.dataset.format === '9:16'`) and using `cx = portrait ? .5 : .72` and `cy = portrait ? .3 : .5`.
In 9:16 the copy sits over the hero. Move the scrim to the bottom for that format with `.ad[data-format='9:16'] .ad_scrim { background: linear-gradient(0deg, color-mix(in srgb, var(--c1) 90%, transparent), color-mix(in srgb, var(--c1) 45%, transparent) 55%, transparent 80%); }` in `styles.css`, and keep the copy at the bottom (`.ad[data-format='9:16'] .ad_copy { align-content: end; }`).

Slots: `data-show="0 1 2"` lists the scenes where a slot is visible (scene numbers start at 0). Usual pattern: kicker and headline in every scene, sub from scene 1, cta only in the last scene. Change `data-show` to match your brief. The foot text (`FOOT_TEXT`) is a tiny mono label with the generic subject and a year, for example `Coffee roaster, 2026`. Prefer keeping it, it is a craft detail. Replace every placeholder in `index.html` (`SUBJECT_TITLE`, `KICKER_TEXT`, `HEADLINE_TEXT`, `SUB_TEXT`, `CTA_TEXT`, `FOOT_TEXT`). check.py lists the ones you forgot.

The `#scenes` control needs exactly one button per scene.

## Checking your own work
- The scene shots are taken again, at a different animation moment, on every check_page run. Read pixels from `OUT/_shots` only AFTER your last check_page run, and say which run the numbers came from.
- Measure the hero in all three formats (use the Format control, or set `ad.dataset.format` in a scratch script). Its mass must stay at least 6 percent of the ad size away from every border, also at mood 1 (the scene with the biggest swell).
- Measure the headline contrast on the third of the line that crosses the hero. It should be at least 3 to 1 against what is behind it. If it is lower, move the hero, lower its mood, or darken the scrim.

## Quality bar for a composed ad
1. One focal thing at every moment. The hero is large, the background is dim and slow, the text reads at a glance (the scrim in ad.css helps, do not remove it).
2. Layers do not fight. Background moves slowly, hero moves medium, nothing moves fast except in the energetic scene.
3. Each scene differs: different slots, a different mood, ideally a different composition of the hero.
4. Palette discipline: only `c1` to `c5`. No other colors anywhere (grey shades of c5 by `color-mix` are fine).
5. Copy is short and real. check.py rejects long copy, claims and prices.
6. Performance: at most 3 layers, one canvas at most, particles 70 or fewer, blobs 6 or fewer.
7. All three formats (16:9, 1:1, 9:16) still read. Use the Format control to test. Positions come from fractions of the ad size, never fixed pixels.

## Pitfalls
- A fourth layer, or a layer that is not in `brief.md`. check.py compares them.
- Hard coded hex colors inside layers. Use `pal`.
- The hero hidden behind the text on `left` layout. Move `cx` to the right side.
- `backdrop-filter` (glass_copy) over a flat background looks like a grey box. Keep a colorful mesh or goo layer behind it.
- Scenes longer than 16 seconds in total. check_page plays only 20 seconds.
- Editing `ad.css` or `helpers.js`. Do not. Put overrides in `styles.css`.

## Done when
`brief.md` is complete and matches the page. The ad plays 2 to 4 scenes in under 16 seconds in a loop, each scene shows a different slot or intensity, 2 or 3 layers share one palette, the three formats work, the scene dots, format and replay controls all do something visible.

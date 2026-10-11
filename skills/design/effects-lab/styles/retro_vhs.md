# Retro VHS

Look: a worn tape playing a synthwave scene. Purple to hot pink sky `#12002b #5b1a8f #ff2a8a #ff9a5c`, a striped sun, a perspective grid floor `#25d0ff`, then everything degraded: scanlines, chromatic fringes, tracking bar, static, jitter, a vignette. On screen display text in `VT323` (add `family=VT323` to the fonts URL, fallback monospace).
Stage: `.stage.h_lg` with the scene inside a `.tv` wrapper. Overlays are absolute children above the scene.

## Technique
1. Scene (clean): sky gradient, sun with horizontal cut stripes using a mask, grid floor with `rotateX(74deg)` and an animated background offset so it flows toward the viewer.
2. Chromatic aberration: a red and a cyan `drop-shadow` on the sun wrapper `.sun_cell` ONLY (see the CSS). On the whole scene it is invisible.
3. Scanlines: `repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px)`.
4. Static: a tiny 160x90 canvas with random gray pixels each frame, scaled up, `mix-blend-mode: screen`, opacity from a slider.
5. Tracking bar: a wide soft light band travels from top to bottom every 6s with a slight horizontal wobble.
6. Glitch: now and then (random every 2 to 6s) the scene shifts sideways in slices for 150ms.
7. OSD: `PLAY` with a triangle, a running timecode, a blinking REC dot, `SP` in a corner, white text with a soft glow.
8. Vignette: radial gradient to black at the corners.

## Code
```css
.tv { position: absolute; inset: 0; overflow: hidden; background: #000; }
.vhs_scene { position: absolute; inset: 0; filter: blur(.4px) saturate(1.3); }   /* NO chromatic filter here, see .sun_cell */
.sky { position: absolute; inset: 0 0 38% 0; background: linear-gradient(180deg, #12002b 0%, #5b1a8f 45%, #ff2a8a 85%, #ff9a5c 100%); }
/* warm bloom behind the sun, the focal element */
.haze { position: absolute; left: -10%; right: -10%; bottom: 20%; height: 44%; filter: blur(24px);
  background: radial-gradient(56% 100% at 50% 96%, rgba(255,154,92,.6), rgba(255,42,138,.24) 46%, transparent 76%);
  animation: haze_drift 9s ease-in-out infinite; }          /* the slow ambient motion next to the fast mechanical loops */
@keyframes haze_drift { 50% { transform: translateY(-14px) scale(1.06); opacity: .8; } }
/* Chromatic fringe MUST sit on a wrapper around the masked circle. A drop-shadow on a full bleed
   rectangle is clipped away, and a drop-shadow on a masked element is erased by its own mask. */
.sun_cell { position: absolute; left: 50%; bottom: 36%; width: 34%; aspect-ratio: 1; transform: translateX(-50%);
  filter: drop-shadow(calc(var(--fr, 2.5px) * -1) 0 0 rgba(255,0,70,.8)) drop-shadow(var(--fr, 2.5px) 0 0 rgba(0,200,255,.8)); }
.sun_body { position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(180deg, #ffe45c 0%, #ff9a5c 34%, #ff2a8a 76%);
  mask-image: repeating-linear-gradient(180deg, #000 0 8%, transparent 8% 10%); -webkit-mask-image: repeating-linear-gradient(180deg, #000 0 8%, transparent 8% 10%); }
/* Grid floor. The plane must stay in FRONT of the camera: long perspective, origin at the top, plane taller than the box. */
.floor { position: absolute; left: 0; right: 0; bottom: 0; height: 38%; overflow: hidden; perspective: 900px; perspective-origin: 50% 0;
  background: linear-gradient(180deg, #33105c 0%, #12002b 55%, #0b001c 100%); }
.horizon { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: rgba(37,208,255,.8); box-shadow: 0 0 28px 8px rgba(37,208,255,.38); }
.grid { position: absolute; left: -100%; right: -100%; top: 0; height: 179%; transform: rotateX(74deg); transform-origin: 50% 0;
  background-image: linear-gradient(rgba(37,208,255,.9) 2px, transparent 2px), linear-gradient(90deg, rgba(37,208,255,.9) 2px, transparent 2px);
  background-size: 64px 64px; animation: grid_flow 1.2s linear infinite;
  mask-image: linear-gradient(180deg, transparent 0%, #000 26%); -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 26%); }
@keyframes grid_flow { to { background-position: 0 64px; } }
.scan { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 1px, transparent 1px 3px); }
.static { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; mix-blend-mode: screen; opacity: var(--noise); pointer-events: none; }
.tv { --noise: .12; --track: .9; }
.track { position: absolute; left: 0; right: 0; height: 16%; top: -20%; pointer-events: none; opacity: var(--track); background: linear-gradient(180deg, transparent, rgba(255,255,255,.14) 45%, rgba(255,255,255,.22) 50%, transparent); mix-blend-mode: overlay; animation: track 6s linear infinite; }
@keyframes track { to { top: 110%; } }
.vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 120% at 50% 50%, transparent 55%, rgba(0,0,0,.75)); }
.osd { position: absolute; font: 400 34px/1 VT323, var(--mono); color: #fff; text-shadow: 0 0 6px rgba(255,255,255,.7), 2px 0 0 rgba(255,0,70,.6), -2px 0 0 rgba(0,200,255,.6); letter-spacing: .06em; pointer-events: none; }
.osd.tl { left: 28px; top: 22px; display: flex; align-items: center; gap: 12px; } .osd.tr { right: 28px; top: 22px; } .osd.bl { left: 28px; bottom: 22px; }
.tri { width: 0; height: 0; border-left: 18px solid #fff; border-top: 11px solid transparent; border-bottom: 11px solid transparent; }
.rec { width: 14px; height: 14px; border-radius: 50%; background: #ff2a2a; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.glitching .vhs_scene { animation: slice .15s steps(3) 1; }
@keyframes slice { 0% { clip-path: inset(0 0 70% 0); transform: translateX(-14px); } 33% { clip-path: inset(30% 0 40% 0); transform: translateX(18px); } 66% { clip-path: inset(65% 0 0 0); transform: translateX(-9px); } 100% { clip-path: inset(0); transform: none; } }
.rewind .vhs_scene { animation: jitter .08s steps(2) infinite; }
@keyframes jitter { 50% { transform: translate(5px, -3px); } }
.no_sun .sun_cell, .no_sun .haze { opacity: 0; animation: none; }   /* animation: none is required, a running animation beats a plain opacity rule */
.no_grid .floor { opacity: 0; }
.sun_cell, .floor { transition: opacity .28s var(--ease); }
@media (max-width: 900px) { .osd { font-size: 24px; } .tri { border-left-width: 13px; border-top-width: 8px; border-bottom-width: 8px; } }
```
```js
function init() {
  const tv = $('.tv'), scene = $('.vhs_scene'), ptr = pointer_in(tv);
  const noise_c = document.createElement('canvas'); noise_c.width = 160; noise_c.height = 90;      // the 160x90 field, drawn offscreen
  const nctx = noise_c.getContext('2d'), frame_img = nctx.createImageData(160, 90);
  const view = fit_canvas($('#static'));                                                          // the visible canvas, sized by the kit
  let next_glitch = 2, tc = 0, rewinding = false, fr = 2.5;
  const pad = (n) => String(n).padStart(2, '0');
  animate_when_visible(tv, (t, dt) => {
    const d = frame_img.data; for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    nctx.putImageData(frame_img, 0, 0);
    view.ctx.imageSmoothingEnabled = false; view.ctx.drawImage(noise_c, 0, 0, view.w, view.h);
    const s = t / 1000; tc += dt * (rewinding ? -6 : 1); tc = Math.max(0, tc);
    $('#tc').textContent = `${pad(Math.floor(tc / 3600))}:${pad(Math.floor(tc / 60) % 60)}:${pad(Math.floor(tc) % 60)}`;
    fr = damp(fr, ptr.inside ? 2.5 + Math.abs(ptr.nx - .5) * 9 : 2.5, 6, dt);                     // the pointer widens the red and cyan fringe
    scene.style.setProperty('--fr', fr.toFixed(2) + 'px');
    if (s > next_glitch && !rewinding) { tv.classList.remove('glitching'); void tv.offsetWidth; tv.classList.add('glitching'); next_glitch = s + rand(2, 6); }
  });
  slider($('#noise'), $('#noise_out'), (v) => tv.style.setProperty('--noise', (v / 100).toFixed(2)));           // 0 to 60 means 0 to 0.60 opacity
  slider($('#tracking'), $('#tracking_out'), (v) => tv.style.setProperty('--track', (v / 200).toFixed(2)));     // 0 to 200 means 0 to 1 opacity, default 100 is .5
  toggle($('#rew'), (on) => { rewinding = on; tv.classList.toggle('rewind', on); $('#mode_txt').textContent = on ? 'REW' : 'PLAY'; });
  seg($('#layer'), (b) => { tv.classList.toggle('no_sun', b.dataset.layer === 'grid'); tv.classList.toggle('no_grid', b.dataset.layer === 'sun'); });
}
init();
```
Set the tracking slider default to 180 in the HTML.
Markup order inside `.tv`: `.vhs_scene` (children: `.sky`, `.haze`, `<div class="sun_cell"><div class="sun_body"></div></div>`, `.floor` with `.horizon` and `.grid`), then the static canvas, `.scan`, `.track`, `.vig`, the OSD. The stage keeps the `h_lg` class (swap `h_md` for `h_lg` in the template). The JS above already widens the fringe from the pointer through `--fr` set on `.vhs_scene`.
Include in the markup an OSD with `<span class="tri"></span><span id="mode_txt">PLAY</span>` and `<span id="tc">00:00:00</span>`, plus `<span class="rec"></span>`. Dates like `AUG 14 1987` are fine as plain text.

## Controls
slider Noise 0 to 60 (opacity percent), toggle Rewind (a `.btn` with `aria-pressed`), slider Tracking 0 to 200 (the JS maps it to the `.track` opacity as value / 200), and `seg` All / Sun / Grid (`data-layer="all|sun|grid"`, handled in the JS above).
The OSD owns the bottom left, so the stage caption is `<span class="tag right">TAPE 04</span>`.
The static canvas is `<canvas class="static" id="static"></canvas>`, it must NOT carry the `fill` class.

## Pitfalls
- Grid invisible: `perspective` too short for the tilted plane, so Chrome clips it at the camera. Keep the card values (900px, origin 50% 0, `rotateX(74deg)`, height 179%).
- Fringe invisible: the drop-shadow is on a full bleed element or on a masked element. Keep it on `.sun_cell`.
- Overlays (static, scanlines, vignette, OSD) stay unfiltered and sit above the scene.
- Noise that is too strong hides the scene. Default opacity .12.
- `clip-path` animation on the scene is the glitch. Remove and re-add the class with a reflow (`void el.offsetWidth`) to retrigger.
- No emoji for play or record icons. Use CSS shapes.

## Done when
Grid lines flow toward the viewer, static visibly crawls, a bar rolls down, the picture tears sideways every few seconds, red and cyan fringes show on edges, timecode counts, Rewind makes everything shake and the code run backwards.

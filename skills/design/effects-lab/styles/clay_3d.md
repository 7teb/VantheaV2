# Clay 3D

Look: soft, inflated, pastel plasticine objects with no hard edges. Light stage `#ece6f6` (the one place a light surface is right). Palette `#ff9ec4` pink, `#7fd8ff` blue, `#ffd66b` yellow, `#a9e89a` green, `#c3a4ff` lilac. Big round shapes, floor shadows, cute eyes that follow the pointer.
Stage: `.stage.h_lg` with `background: radial-gradient(120% 90% at 30% 10%, #f7f2ff, #e2daf0)`. Chrome stays dark.

## Technique
1. Volume comes from `box-shadow` only, with 3 parts per object: a dark inner shadow bottom right, a light inner shadow top left, a soft outer drop shadow. Colors derived from the object color with `color-mix`.
2. `--puff` multiplies the inner shadow sizes. A slider on it changes how inflated everything looks.
3. A separate blurred ellipse is the floor shadow. It shrinks and fades when the object lifts, and grows when it comes back down. `bob` is negative when the object is up, so the scale is `1 + bob / 90`.
4. Idle: each object bobs slowly with a different phase.
5. Press: spring squish. Release: spring back with overshoot (this card is allowed to bounce).
6. Eyes: two white circles with dark pupils. Pupils offset toward the pointer, limited to 6px.

## Code
```css
.clay_stage { --puff: 1; background: radial-gradient(120% 90% at 30% 10%, #f7f2ff, #e2daf0); }
.clay { --c: #ff9ec4; position: absolute; background: var(--c); transform-origin: 50% 100%; will-change: transform;
  box-shadow:
    inset calc(-12px * var(--puff)) calc(-18px * var(--puff)) calc(26px * var(--puff)) color-mix(in srgb, var(--c) 62%, #3a1d5a),
    inset calc(12px * var(--puff)) calc(14px * var(--puff)) calc(20px * var(--puff)) color-mix(in srgb, var(--c) 55%, #fff),
    0 22px 30px -14px color-mix(in srgb, var(--c) 45%, #3a1d5a); cursor: grab; touch-action: none; }
.blob { width: 190px; height: 170px; border-radius: 48% 52% 46% 54% / 56% 50% 50% 44%; }
.ball { width: 130px; height: 130px; border-radius: 50%; }
.pill { width: 90px; height: 210px; border-radius: 999px; }
.cube { width: 120px; height: 120px; border-radius: 34px; }
.floor { position: absolute; height: 22px; border-radius: 50%; background: rgba(58,29,90,.28); filter: blur(10px); }
.eye { position: absolute; width: 30px; height: 36px; border-radius: 50%; background: #fff; box-shadow: inset 0 -3px 5px rgba(0,0,0,.12); }
.eye i { position: absolute; left: 50%; top: 50%; width: 13px; height: 15px; margin: -7px 0 0 -6px; border-radius: 50%; background: #2a1840; }
```
Markup. Every `.clay` is directly followed by its `.floor`, and the stage carries `data-tone`:
```html
<div class="stage h_lg clay_stage" id="stage" data-tone="pastel">
  <div class="clay blob c1" style="left:12%;top:30%"><span class="eye" style="left:34%;top:34%"><i></i></span><span class="eye" style="left:58%;top:34%"><i></i></span><span class="smile"></span></div>
  <div class="floor" style="left:12%;top:calc(30% + 160px);width:170px"></div>
  <div class="clay ball c2" style="left:46%;top:48%"></div><div class="floor" style="left:46%;top:calc(48% + 118px);width:120px"></div>
  <div class="clay pill c3" style="left:70%;top:22%"></div><div class="floor" style="left:70%;top:calc(22% + 196px);width:84px"></div>
  <div class="clay cube c4" style="left:28%;top:62%"></div><div class="floor" style="left:28%;top:calc(62% + 108px);width:110px"></div>
  <span class="tag">Clay</span>
</div>
```
`.eye` is `position: absolute`, `.smile { position: absolute; left: 50%; bottom: 22%; width: 28px; height: 14px; margin-left: -14px; border-bottom: 5px solid #2a1840; border-radius: 0 0 28px 28px; }`. Give every `.clay` and `.floor` a `--k` scale (set on the stage: 1 wide, .82 at 800, .64 at 390 through media queries) and size them with `calc(190px * var(--k))` so nothing overflows on a phone.
After a `drag()` or a resize an object can end up outside the stage. Re-clamp `left` and `top` into the stage on resize.
Light stage note: the base `.tag` is grey for dark stages. Override it for this stage only: `.clay_stage .tag { color: #3a1d5a; }`.
Tones (a seg that sets `data-tone` and CSS reads `[data-tone=...] .c1 { --c: ... }`): pastel `#ff9ec4 #7fd8ff #ffd66b #a9e89a #c3a4ff`, candy `#ff5c8a #35c4ff #ffc233 #5ee06a #a06bff`, mono (must stay visible on the light stage, about 70 percent lightness or darker) `#9a9aa6 #b4b4c0 #8a8a96 #a4a4b0 #c0c0cc`.
```js
const stage = $('#stage'), ptr = pointer_in(stage);
function spring(k = 190, d = 11) { return { x: 1, v: 0, t: 1, step(dt) { const a = -k * (this.x - this.t) - d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; } }; }
const items = $$('.clay', stage).map((el, i) => ({ el, sp: spring(), ph: i * 1.7, eyes: $$('.eye i', el), floor: el.nextElementSibling }));
items.forEach((it) => {
  it.el.addEventListener('pointerdown', () => { it.sp.t = .72; });
  window.addEventListener('pointerup', () => { it.sp.t = 1; });
});
animate_when_visible(stage, (t, dt) => {
  const s = t / 1000, sb = stage.getBoundingClientRect();
  items.forEach((it) => {
    const k = it.sp.step(dt), bob = Math.sin(s * 1.3 + it.ph) * 7;
    it.el.style.transform = `translateY(${bob.toFixed(1)}px) scale(${(1 + (1 - k) * .45).toFixed(3)}, ${k.toFixed(3)})`;
    if (it.floor) { it.floor.style.transform = `scale(${(1 + bob / 90).toFixed(3)})`; it.floor.style.opacity = (1 + bob / 40).toFixed(2); }   // up (bob < 0) = smaller and fainter
    const r = it.el.getBoundingClientRect();
    it.eyes.forEach((p) => {
      const ex = r.left - sb.left + r.width / 2, ey = r.top - sb.top + r.height * .4;
      const dx = (ptr.inside ? ptr.x : ex + Math.cos(s) * 40) - ex, dy = (ptr.inside ? ptr.y : ey) - ey, d = Math.hypot(dx, dy) || 1, m = Math.min(6, d / 12);
      p.style.transform = `translate(${dx / d * m}px, ${dy / d * m}px)`;
    });
  });
});
slider($('#puff'), $('#puff_out'), (v) => stage.style.setProperty('--puff', (v / 100).toFixed(2)));
```
Position items with inline `left` and `top`, each followed by its `.floor` element placed under it. Drag with `drag(el, stage)` from the helpers. Add a smile: a 28px wide, 14px tall element with `border-bottom: 5px solid #2a1840; border-radius: 0 0 28px 28px`.

## Controls
slider Puffiness 20 to 160, `seg` Pastel / Candy / Mono (swap the `--c` values by class), button Shuffle (re-place items with random positions, they glide because `left` and `top` have `transition: left .6s var(--ease), top .6s var(--ease)`, remove the transition while dragging).

## Pitfalls
- Dark clay looks like rubber. Keep colors light and soft, never below 55 percent lightness. But on the light stage a very pale gray vanishes, keep the mono set at the values above.
- Hard 1px lines kill the illusion. Only soft shadows.
- Squash must scale X up when Y goes down, so volume feels preserved.
- Eyes must be inside the body and move by only a few pixels.

## Done when
Objects look puffy and soft, bob idly, squish and wobble when pressed, eyes track the cursor, the puffiness slider visibly changes the inflation.

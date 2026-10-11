# Kinetic type

Look: huge letters, tight tracking, one accent color on near black. Letters behave like physical things: they wave, change weight, scatter from the pointer. Plus a pair of outlined marquee rows.
Stage: `.stage.h_lg`, a big word centered, marquee rows at the top and bottom edges.
Font: Inter as a variable font. Change the Google Fonts URL in the template to `Inter:wght@100..900`. Fallback stack stays.

## Technique
1. Split the word into one `span.ch` per letter. Keep the readable text in `aria-label`.
2. Give every letter a fixed width (`.72em`) and `text-align: center` so weight changes do not reflow the line.
3. Each frame compute per letter: wave offset, variable weight, pointer repel. Write them to `transform` and `font-variation-settings`.
4. Letter positions are cached on resize, not measured every frame.
5. Marquee: duplicated content in a flex row, `animation: marq 30s linear infinite` to `translateX(-50%)`.

## Code
```html
<div class="stage h_lg" id="stage">
  <div class="marq top"><div class="marq_in"><span>MOTION</span><span>MOTION</span><span>MOTION</span><span>MOTION</span></div></div>
  <h2 class="word" id="word">Kinetic</h2>
  <div class="marq bot rev"><div class="marq_in"><span>TYPE</span><span>TYPE</span><span>TYPE</span><span>TYPE</span></div></div>
</div>
```
```css
.stage { display: grid; place-items: center; background: #050505; }
.word { font-size: clamp(72px, 16vw, 220px); font-weight: 700; letter-spacing: -.04em; line-height: 1; color: #f4f4f4; user-select: none; white-space: nowrap; }
.ch { display: inline-block; width: .72em; text-align: center; will-change: transform; font-variation-settings: 'wght' 700; }
.marq { position: absolute; left: 0; right: 0; overflow: hidden; pointer-events: none; }
.marq.top { top: 18px; } .marq.bot { bottom: 18px; }
.marq_in { display: flex; width: max-content; animation: marq 30s linear infinite; }
.marq.rev .marq_in { animation-direction: reverse; }
.marq span { font-size: 64px; font-weight: 800; letter-spacing: .04em; padding-right: 48px; color: transparent; -webkit-text-stroke: 1px rgba(255,255,255,.22); }
@keyframes marq { to { transform: translateX(-50%); } }
```
Every marquee row needs its content duplicated so that half of the row equals one full cycle (the 4 spans above are 2 cycles of 2).
```js
const stage = $('#stage'), word = $('#word'), ptr = pointer_in(stage);
function split(el) {
  const text = el.textContent; el.textContent = ''; el.setAttribute('aria-label', text);
  return [...text].map((ch) => { const s = document.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true'); s.textContent = ch === ' ' ? '\u00a0' : ch; el.appendChild(s); return s; });
}
const letters = split(word).map((el) => ({ el, cx: 0, cy: 0, x: 0, y: 0, w: 700 }));
let mode = 'wave', speed = 1;
function measure() {
  const sb = stage.getBoundingClientRect();
  letters.forEach((l) => { const r = l.el.getBoundingClientRect(); l.cx = r.left - sb.left + r.width / 2 - l.x; l.cy = r.top - sb.top + r.height / 2 - l.y; });
}
new ResizeObserver(measure).observe(stage); measure();

animate_when_visible(stage, (t, dt) => {
  const s = t / 1000 * speed;
  letters.forEach((l, i) => {
    let tx = 0, ty = 0, tw = 700;
    if (mode === 'wave') { ty = Math.sin(s * 2.2 + i * .6) * 26; tw = 500 + 300 * Math.sin(s * 1.6 + i * .5); }
    if (mode === 'weight') { tw = 100 + 800 * (.5 + .5 * Math.sin(s * 1.8 + i * .55)); }
    if (mode === 'scatter') { tw = 800; }
    if (ptr.inside) {
      const dx = l.cx - ptr.x, dy = l.cy - ptr.y, d = Math.hypot(dx, dy) + .01, f = Math.max(0, 1 - d / 260);
      if (mode === 'scatter') { const k = f * f * (ptr.down ? 260 : 150); tx += dx / d * k; ty += dy / d * k; tw = 900 - f * 700; }
      else { ty += -f * 40; tw = lerp(tw, 900, f); }
    }
    l.x = damp(l.x, tx, 9, dt); l.y = damp(l.y, ty, 9, dt); l.w = damp(l.w, tw, 9, dt);
    l.el.style.transform = `translate3d(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px,0)`;
    l.el.style.fontVariationSettings = `'wght' ${Math.round(l.w)}`;
  });
});
seg($('#mode'), (b) => { mode = b.dataset.mode; });
slider($('#speed'), $('#speed_out'), (v) => { speed = v / 10; });
```
Accent: color the letters by weight, `hsl(calc(190 + w * .2), 90%, 70%)` (compute in JS), or keep white and tint one letter.

## Controls
`seg` Wave / Weight / Scatter, slider Speed 2 to 30.

## Pitfalls
- Without a fixed letter width the word jitters when weight changes.
- Measuring rects every frame is slow and causes feedback with the transforms. Cache them.
- `font-variation-settings` does nothing if the variable font failed to load. With the system fallback the weight snaps. Acceptable, the wave and scatter still work.
- Marquee text must be much lighter than the main word (stroke only).

## Done when
Letters ripple with changing thickness, hovering parts the letters away, Scatter explodes them from the cursor and they spring back, marquee rows slide in opposite directions.

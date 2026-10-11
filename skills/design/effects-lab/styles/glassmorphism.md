# Glassmorphism

Look: a vivid, slowly drifting backdrop of big gradient orbs (`#ff3d9a #ff9a3d #25d0ff #7a5cff #3dffb0`) on `#07070b`, and frosted panels floating over it. White text on glass. Big soft shadows.
Stage: `.stage` with height 600px (the stage needs room). Backdrop layer, then glass elements.

## Technique
1. Backdrop first. Without colorful content behind the glass there is nothing to blur. Use 4 orbs (200 to 340px, gradient fills) with slow `translate` keyframes (14 to 21s, ease-in-out, infinite). Add one huge word behind as a hard edge for the blur to chew on.
2. Glass = translucent white fill + `backdrop-filter: blur() saturate()` + a bright top inset edge + a faint ring + a diagonal sheen + a deep outer shadow.
3. Tunable CSS variables on the stage: `--blur`, `--tint`, `--sat`. Sliders write them.
4. Elements are draggable (`drag(el, stage)`) so the viewer sees the backdrop through them.
5. A lens: a round glass with almost no blur and `saturate(1.9) brightness(1.2)`.

## Code
```css
.glass_stage { --blur: 18px; --tint: .08; --sat: 160%; height: 600px; background: #07070b; }
.g_bg { position: absolute; inset: 0; overflow: hidden; }
.orb { position: absolute; border-radius: 50%; }
.o1 { width: 340px; height: 340px; left: 6%; top: 8%; background: linear-gradient(135deg, #ff3d9a, #ff9a3d); animation: drift1 16s ease-in-out infinite; }
.o2 { width: 300px; height: 300px; left: 46%; top: 30%; background: linear-gradient(135deg, #25d0ff, #7a5cff); animation: drift2 19s ease-in-out infinite; }
@keyframes drift1 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(90px,60px); } 66% { transform: translate(30px,150px); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-160px,70px); } }
.g_word { position: absolute; right: 4%; bottom: -3%; font-size: clamp(120px, 22vw, 300px); font-weight: 800; letter-spacing: -.06em; line-height: 1; color: rgba(255,255,255,.92); user-select: none; }
.glass { position: absolute; border-radius: 22px;
  background: rgba(255,255,255,var(--tint));
  -webkit-backdrop-filter: blur(var(--blur)) saturate(var(--sat)); backdrop-filter: blur(var(--blur)) saturate(var(--sat));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.38), inset 0 0 0 1px rgba(255,255,255,.1), inset 0 -24px 40px -24px rgba(255,255,255,.1), 0 24px 60px rgba(0,0,0,.35); }
.glass::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 42%); pointer-events: none; }
.g_lens { width: 160px; height: 160px; border-radius: 50%; cursor: grab;
  background: radial-gradient(circle at 32% 26%, rgba(255,255,255,.28), rgba(255,255,255,.02) 55%);
  -webkit-backdrop-filter: blur(2px) saturate(1.9) brightness(1.2); backdrop-filter: blur(2px) saturate(1.9) brightness(1.2); }
.g_lens::before { background: none; }
```
```js
const stage = $('#glass_stage');
slider($('#g_blur'), $('#g_blur_out'), (v) => stage.style.setProperty('--blur', v + 'px'));
slider($('#g_sat'), $('#g_sat_out'), (v) => stage.style.setProperty('--sat', v + '%'));
slider($('#g_tint'), $('#g_tint_out'), (v) => stage.style.setProperty('--tint', (v / 100).toFixed(2)));
$$('[data-drag]', stage).forEach((el) => drag(el, stage));
```
Panel idea: a glass panel in the top left holding the 3 sliders as rows (label 82px, slider 1fr, output 34px) so the viewer tunes the glass with the glass. Panel text color `#fff`, label in mono 11px uppercase.

## Controls
Blur 0 to 40, Saturation 100 to 250, Tint 0 to 40. These may sit inside the glass panel instead of below the stage. If so keep an empty `.controls` out of the page.

## Pitfalls
- Nothing blurs: the backdrop is missing, or an ancestor has `opacity < 1`, `filter` or `mix-blend-mode`. The `.reveal` fade is fine once finished.
- Glass over a flat dark color looks like a gray box. The backdrop must have bright hues and a hard edge.
- Keep text on glass white with weight 500 or more, tint above 0.06.
- Do not draw a 1px solid border. Use the inset ring.

## Done when
Moving a glass card over an orb visibly blurs and tints it, the sheen and top edge highlight read as a glass edge, sliders change blur live.

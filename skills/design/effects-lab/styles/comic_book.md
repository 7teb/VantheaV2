# Comic book

Look: printed pop art. Paper `#fff4d6`, ink `#111`, flat primaries `#ffd400 #e63232 #1e63d6 #2bd0e8`, thick black outlines, hard offset shadows, halftone dots, speed lines, burst shapes with sound effect words. Inside the stage only. The chrome stays dark.
Stage: `.stage.h_lg` with `background: #fff4d6`. Fonts: `Bangers` for sound words and captions, fallback `Impact, 'Arial Black', sans-serif`. Add `family=Bangers` to the Google Fonts URL. Body text in bubbles: `'Comic Neue'` or the fallback `'Comic Sans MS', system-ui`.

## Technique
1. Panels are rectangles with a 5px ink border, a hard shadow `8px 8px 0 #111`, and a tiny rotation (-1 to 1 degree).
2. Halftone: `radial-gradient(circle, <ink color> 28%, transparent 30%)` with `background-size: var(--dot) var(--dot)`. A mask fades it out in one direction so the dots shrink.
3. Speed lines: `repeating-conic-gradient(from 0deg at 50% 50%, #111 0 1.5deg, transparent 1.5deg 6deg)` masked so the center is clear: `mask-image: radial-gradient(circle, transparent 22%, #000 62%)`.
4. Burst: a `clip-path: polygon(...)` with 20 points alternating inner and outer radius. Generate the polygon string in JS. A black burst behind a slightly smaller yellow burst gives the outline.
5. Speech bubble: rounded box with a 4px ink border and a tail made of two triangles (ink one slightly bigger).
6. Text effects: `-webkit-text-stroke: 3px #111` with `paint-order: stroke fill`, and `text-shadow: 4px 4px 0 #111`.

## Code
```css
.comic { --dot: 12px; background: #fff4d6; }
.panel { position: absolute; background: var(--bg-p, #fff); border: 5px solid #111; box-shadow: 8px 8px 0 #111; overflow: hidden; transition: transform .2s cubic-bezier(.3,1.6,.5,1); }
.panel:hover { transform: rotate(var(--r, 0deg)) translate(-3px, -3px); box-shadow: 11px 11px 0 #111; }
.dots { position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(230,50,50,.85) 28%, transparent 30%); background-size: var(--dot) var(--dot);
  mask-image: linear-gradient(135deg, #000, transparent 75%); -webkit-mask-image: linear-gradient(135deg, #000, transparent 75%); }
.lines { position: absolute; inset: -20%; background: repeating-conic-gradient(from 0deg at 50% 50%, #111 0 1.5deg, transparent 1.5deg 6deg);
  mask-image: radial-gradient(circle, transparent 22%, #000 62%); -webkit-mask-image: radial-gradient(circle, transparent 22%, #000 62%); animation: lines_spin 40s linear infinite; }
@keyframes lines_spin { to { transform: rotate(360deg); } }
.sfx { font-family: Bangers, Impact, 'Arial Black', sans-serif; font-size: 110px; letter-spacing: .03em; color: #ffd400; -webkit-text-stroke: 4px #111; paint-order: stroke fill; text-shadow: 6px 6px 0 #111; transform: rotate(-6deg); }
.bubble { position: absolute; padding: 14px 20px; background: #fff; border: 4px solid #111; border-radius: 28px; font: 700 20px/1.2 'Comic Neue', 'Comic Sans MS', system-ui; color: #111; }
.bubble::before { content: ''; position: absolute; left: 36px; bottom: -26px; border: 14px solid transparent; border-top: 24px solid #111; border-bottom: 0; }
.bubble::after { content: ''; position: absolute; left: 40px; bottom: -17px; border: 10px solid transparent; border-top: 18px solid #fff; border-bottom: 0; }
.caption { position: absolute; padding: 6px 12px; background: #ffd400; border: 3px solid #111; font: 400 18px Bangers, Impact, sans-serif; letter-spacing: .06em; color: #111; }
.pop { position: absolute; pointer-events: none; font-family: Bangers, Impact, sans-serif; color: #fff; -webkit-text-stroke: 4px #111; paint-order: stroke fill; text-shadow: 5px 5px 0 #111; animation: pop .7s cubic-bezier(.2,1.6,.4,1) forwards; }
@keyframes pop { 0% { transform: translate(-50%,-50%) scale(0) rotate(-20deg); opacity: 1; } 30% { transform: translate(-50%,-50%) scale(1.15) rotate(-8deg); } 100% { transform: translate(-50%,-70%) scale(1) rotate(-8deg); opacity: 0; } }
```
```js
function burst_clip(points = 20, inner = 58, outer = 100) {
  const pts = []; for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 ? inner : outer) * (i % 2 ? 1 : .9 + Math.random() * .1) / 2, a = i / (points * 2) * TAU;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(1)}% ${(50 + Math.sin(a) * r).toFixed(1)}%`);
  } return `polygon(${pts.join(',')})`;
}
// build: <div class="burst black"></div><div class="burst yellow"></div> same clip, black is 6% larger (inset: -3%)
const WORDS = ['POW', 'BAM', 'ZAP', 'WHAM', 'KRAK', 'BOOM'];
const stage = $('#stage');
stage.addEventListener('pointerdown', (e) => {
  const r = stage.getBoundingClientRect(), el = document.createElement('div');
  el.className = 'pop'; el.textContent = WORDS[(Math.random() * WORDS.length) | 0] + '!';
  el.style.left = (e.clientX - r.left) + 'px'; el.style.top = (e.clientY - r.top) + 'px'; el.style.fontSize = rand(60, 120) + 'px';
  el.style.color = ['#ffd400', '#2bd0e8', '#fff', '#ff6b6b'][(Math.random() * 4) | 0];
  stage.appendChild(el); setTimeout(() => el.remove(), 800);
});
slider($('#dot'), $('#dot_out'), (v) => stage.style.setProperty('--dot', v + 'px'));
```
Composition (desktop), all panels `position: absolute`, 20px from the stage edges and 20px between panels (the border and shadow add to it):
- Panel A: `left: 20px; top: 20px; width: calc(56% - 30px); height: calc(100% - 40px)`. Holds `.lines`, two `.burst` layers and the `.sfx` word.
- Panel B: `right: 20px; top: 20px; width: calc(44% - 30px); height: calc(45% - 30px)`, yellow background `--bg-p: #ffd400`, holds the bubble.
- Panel C: `right: 20px; bottom: 20px; width: calc(44% - 30px); height: calc(55% - 30px)`, blue `--bg-p: #1e63d6`, holds `.dots` and the yellow `.caption`.
- Under 760px: panel A full width and top half, B and C side by side in the bottom half.
Set the tilt in the markup: `<div class="panel" style="--r: -1deg; --bg-p: #fff">` with `--r` -1deg, 1deg and -.5deg, and use `transform: rotate(var(--r))` plus the same `rotate` in the `:hover` rule.
Burst layers: `.burst` is `position: absolute; top: 50%; left: 50%; width: 55%; height: 0; padding-bottom: 55%; transform: translate(-50%, -50%)` (square by padding). The black one is 58% wide so it shows as an outline around the yellow. Both take the same `clip-path: polygon(...)` string from `burst_clip` (set it inline from JS). `TAU` and `rand` come from helpers.js.
Fonts line for the template: `family=Bangers&family=Comic+Neue:wght@400;700`.
Dot colors: `.dots.color-red { --dot-color: rgba(230,50,50,.85) }`, `.color-blue` rgba(30,99,214,.85), `.color-cyan` rgba(43,208,232,.85). The `.dots` rule uses `var(--dot-color)` in its radial gradient.

## Controls
```html
<label class="range">Dot <input id="dot" type="range" min="6" max="24" value="12"><output id="dot_out">12</output></label>
<div class="seg" id="color" role="group" aria-label="Dot color"><button data-mode="red" aria-pressed="true">Red</button><button data-mode="blue" aria-pressed="false">Blue</button><button data-mode="cyan" aria-pressed="false">Cyan</button></div>
<button class="btn" id="shuffle">Shuffle</button>
```
slider Dot size 6 to 24 (sets `--dot` on the stage), `seg` Red / Blue / Cyan (swaps the `color-*` class on `.dots`), button Shuffle (rerolls `burst_clip`, the SFX word and the caption). Put the caption words in an array (MEANWHILE, LATER THAT NIGHT, SUDDENLY) for Shuffle.

## Pitfalls
- No offset shadows or a blurred shadow. Comic shadows are hard and ink black.
- Anti aliased gradients inside art. Use flat fills only.
- `clip-path` cuts off borders and shadows. Use two stacked clipped layers for the outline.
- Text without stroke on a busy background disappears. Stroke everything big.

## Done when
It reads as printed pop art: flat color, thick ink, dots, burst and speed lines, clicking anywhere pops a colored sound word that fades upward, panels lift on hover.

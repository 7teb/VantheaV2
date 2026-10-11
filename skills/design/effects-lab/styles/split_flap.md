# Split flap display

Look: an old train station board. Charcoal flaps `#16161a`, off white characters `#f2f2f2`, a black hinge line across the middle, thin gaps between cells, a dark frame, a warm amber accent for one status column. Every character flips through the alphabet to its target with a soft clatter.
Stage: `.stage.h_lg` with a dark board `#0c0c0f` centered. Font: the mono from the kit, weight 700.

## Technique
1. A cell has 4 layers: static top (shows the NEW char), static bottom (shows the OLD char), flap top (OLD char, rotates 0 to -90deg), flap bottom (NEW char, rotates 90deg to 0).
2. Each layer shows only half of the glyph. The span inside is as tall as the whole cell, pinned to the top (top half) or the bottom (bottom half), and the half clips it.
3. One flip step = flap top falls (70ms ease in), then flap bottom lands (70ms ease out). Use the Web Animations API.
4. To change a character, step through the charset one flip at a time from the current index to the target index, so it visibly cycles. Stagger cells by column.
5. Optional click sound with WebAudio, off by default.

## Code
```css
.board { position: absolute; inset: 0; display: grid; place-content: center; gap: 10px; padding: 24px; background: radial-gradient(90% 90% at 30% 14%, #17171d, #0a0a0c); }   /* light from the top left */
.row { display: flex; gap: 6px; justify-content: center; }
.row.split .cell:nth-child(9) { margin-right: 14px; }          /* gap between the 9 destination cells and the 5 status cells */
.cell { --w: 46px; --h: 68px; position: relative; width: var(--w); height: var(--h); perspective: 320px; text-align: center;
  font-family: var(--mono); font-weight: 700; font-size: calc(var(--h) * .68); line-height: var(--h); }   /* longhands, one bad value in a shorthand kills the whole declaration */
.cell::after { content: ''; position: absolute; left: 0; right: 0; top: calc(50% - 1px); height: 2px; background: #000; z-index: 5; }
.half { position: absolute; left: 0; right: 0; height: 50%; overflow: hidden; background: #17171c; color: #f2f2f2; backface-visibility: hidden; }
.half span { position: absolute; left: 0; right: 0; height: var(--h); line-height: var(--h); }
.half.top { top: 0; border-radius: 7px 7px 0 0; box-shadow: inset 0 1px 0 rgba(255,255,255,.06); }
.half.top span { top: 0; }
.half.bottom { bottom: 0; border-radius: 0 0 7px 7px; background: #131318; box-shadow: inset 0 -2px 3px rgba(0,0,0,.5); }
.half.bottom span { bottom: 0; }
.flap_top { transform-origin: 50% 100%; z-index: 3; }
.flap_bot { transform-origin: 50% 0; transform: rotateX(90deg); z-index: 3; }
.cell.amber .half { color: #ffb347; }
@media (max-width: 900px) { .cell { --w: 30px; --h: 46px; } .row { gap: 4px; } }   /* 14 cells must fit an 800px wide page, so break at 900 */
@media (max-width: 520px) { .cell { --w: 20px; --h: 32px; } }
```
```js
const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-';
const board = $('#board'); let sound = false, audio = null;
function tick() {
  if (!sound) return; audio = audio || new AudioContext();
  const o = audio.createOscillator(), g = audio.createGain(); o.type = 'square'; o.frequency.value = rand(900, 1500);
  g.gain.setValueAtTime(.02, audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .03);
  o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .03);
}
function make_cell(extra = '') {
  const el = document.createElement('div'); el.className = 'cell ' + extra;
  el.innerHTML = '<div class="half top"><span></span></div><div class="half bottom"><span></span></div><div class="half top flap_top"><span></span></div><div class="half bottom flap_bot"><span></span></div>';
  const [st, sb, ft, fb] = [...el.children].map((n) => n.firstChild);
  [st, sb, ft, fb].forEach((s) => (s.textContent = '\u00a0'));
  return { el, st, sb, ft, fb, idx: 0, busy: false };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FLIP_MS = 70, MAX_STEPS = 14;
const FALL = [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }];
const LAND = [{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }];
async function flip_once(cell, next) {
  const old = CHARS[cell.idx], nc = next === ' ' ? '\u00a0' : next, oc = old === ' ' ? '\u00a0' : old;
  cell.st.textContent = nc; cell.sb.textContent = oc; cell.ft.textContent = oc; cell.fb.textContent = nc;
  const top = cell.ft.parentElement, bot = cell.fb.parentElement;
  tick();
  // Time each half with wait() so the step length is exact and the pinned pose below is applied at a known moment.
  const fall = top.animate(FALL, { duration: FLIP_MS, easing: 'ease-in', fill: 'forwards' });
  await wait(FLIP_MS); fall.cancel(); top.style.transform = 'rotateX(-90deg)';   // pin the settled pose, a cancelled animation would snap back and cover the static half
  const land = bot.animate(LAND, { duration: FLIP_MS, easing: 'ease-out', fill: 'forwards' });
  await wait(FLIP_MS); land.cancel(); bot.style.transform = 'rotateX(0deg)';
  cell.sb.textContent = nc;
}
async function flip_to(cell, ch, delay = 0) {
  const target = Math.max(0, CHARS.indexOf(ch.toUpperCase())); cell.target = target;
  if (cell.busy) return; cell.busy = true; await wait(delay);
  // Cap the walk. If the target is further than MAX_STEPS away, jump the index forward silently first,
  // so a long change takes about 1 second and not 4.
  const dist = (cell.target - cell.idx + CHARS.length) % CHARS.length;
  if (dist > MAX_STEPS) { cell.idx = (cell.target - MAX_STEPS + CHARS.length) % CHARS.length; }
  while (cell.idx !== cell.target) { const n = (cell.idx + 1) % CHARS.length; await flip_once(cell, CHARS[n]); cell.idx = n; await wait(15); }
  cell.busy = false;
}
```
After the silent jump the visible character is wrong for one frame, so also set all four spans to `CHARS[cell.idx]` right after changing `cell.idx` (a helper `show(cell)`).
Build 5 rows (70 cells), `COLS = 14`, and give each departures row the class `split`. The middle row is row 3. Cells stay `busy` while walking, which is why a row that changes again mid walk just updates `cell.target`.
Sanitise the field: `value.toUpperCase().replace(/[^A-Z0-9:.\- ]/g, '').slice(0, 14)`.
Drive the visible changes (the board cycle every 5 seconds, a clock ticking every second) from `setInterval`, and keep rAF for the pointer light only. Show a message with `set_rows(['LONDON  14:05', 'PARIS   14:20', ...])`: pad each string to COLS, call `flip_to(cell, ch, col * 40)` for each cell. Add `amber` class to the last 5 cells of each row for the status time or gate.
Auto cycle: every 5 seconds set the next entry of a list of 3 boards unless the user typed. Use only real generic words (city names, times, status words like ON TIME, BOARDING, DELAYED). No invented brands.

## Controls
text `field` (max length 14, uppercase) with a `btn` Flip that writes it on the middle row, toggle Sound, `seg` Departures / Words (swap the preset board).

## Pitfalls
- The half clipping is the trick. If both halves show the whole glyph, the span height is wrong.
- Without `backface-visibility: hidden` the falling flap shows a mirrored glyph.
- Animating all cells at once kills performance. Only cells that differ flip, 56 cells is fine.
- Flip direction: top flap goes away from the viewer (rotateX negative), the bottom flap comes toward (positive to 0).

## Done when
Characters visibly clatter through the alphabet in a left to right wave and land on their target, the hinge line sits across each cell, typing a word re-flips only the needed cells.

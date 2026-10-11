# Neo brutalism

Look: loud, flat, honest. Saturated flat backgrounds (`#ffde59` yellow, `#ff90e8` pink, `#90a8ed` blue, `#b8ff9f` mint, cream `#fff8e6`), thick black outlines (3px), hard offset shadows with zero blur (`6px 6px 0 #000`), slight rotations, giant grotesque type, stickers, a marquee. Everything is a bit crooked on purpose. Fonts: `Space Grotesk` 700 for body, `Archivo Black` for headlines (add `family=Space+Grotesk:wght@500;700&family=Archivo+Black` to the fonts URL, fallback `Arial Black, Impact, sans-serif`).
Inside the stage thick borders ARE the style. The dark chrome around the stage stays as it is.
Stage: `.stage.h_lg`, background cream or the chosen accent.

## Technique
1. Every object: `border: 3px solid #000; box-shadow: 6px 6px 0 #000; border-radius: 0` (or 10px, never fully round except badges).
2. Press physics: hover lifts `translate(-2px,-2px)` with shadow `8px 8px 0`, active sinks `translate(4px,4px)` with shadow `2px 2px 0`.
3. Headline bars: three giant words each on its own color bar, alternately rotated -1.5 and 1deg, overlapping a little.
4. Marquee ticker: black bar with big cream text sliding left, duplicated content.
5. Stickers: draggable badges (circle, star burst via clip-path, rectangle label) with hard shadows. Add Sticker spawns a random one with a bouncy pop (bounce is allowed here).
6. Dotted or grid paper background: `radial-gradient(#0002 1.5px, transparent 1.5px) 0 0 / 22px 22px`.
7. A theme seg changes `--acc` and the stage background.

## Code
```css
.nb { --acc: #ffde59; --ink: #000; background: #fff8e6 radial-gradient(#0002 1.5px, transparent 1.5px) 0 0 / 22px 22px; font-family: 'Space Grotesk', Arial, sans-serif; color: #000; }
.nb_bar { position: absolute; left: 6%; padding: 6px 28px 10px; border: 3px solid #000; box-shadow: 8px 8px 0 #000; font: 400 clamp(52px, 10vw, 128px)/1 'Archivo Black', 'Arial Black', Impact, sans-serif; letter-spacing: -.02em; text-transform: uppercase; }
.nb_bar.a { top: 8%; background: var(--acc); transform: rotate(-1.5deg); }
.nb_bar.b { top: 32%; left: 14%; background: #ff90e8; transform: rotate(1deg); }
.nb_bar.c { top: 56%; left: 8%; background: #90a8ed; transform: rotate(-.5deg); }
.nb_btn { padding: 10px 20px; border: 3px solid #000; background: #fff; font: 700 16px 'Space Grotesk', Arial, sans-serif; box-shadow: 5px 5px 0 #000; cursor: pointer; transition: transform .08s linear, box-shadow .08s linear; }
.nb_btn:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 #000; }
.nb_btn:active { transform: translate(4px, 4px); box-shadow: 1px 1px 0 #000; }
.nb_ticker { position: absolute; left: -2%; right: -2%; bottom: 7%; background: #000; color: #fff8e6; transform: rotate(-1.2deg); overflow: hidden; border-top: 3px solid #000; border-bottom: 3px solid #000; }
.nb_ticker .in { display: flex; width: max-content; animation: marq 22s linear infinite; }
.nb_ticker span { padding: 10px 26px; font: 400 26px 'Archivo Black', 'Arial Black', Impact, sans-serif; text-transform: uppercase; white-space: nowrap; }
@keyframes marq { to { transform: translateX(-50%); } }
.sticker { position: absolute; display: grid; place-items: center; width: 110px; height: 110px; border: 3px solid #000; box-shadow: 5px 5px 0 #000; font: 400 22px 'Archivo Black', 'Arial Black', Impact, sans-serif; text-transform: uppercase; cursor: grab; user-select: none; animation: stick_pop .5s cubic-bezier(.3, 1.8, .5, 1) both; }
.sticker.round { border-radius: 50%; } .sticker.label { width: 150px; height: 56px; }
.sticker.burst { border: 0; box-shadow: none; filter: drop-shadow(5px 5px 0 #000); clip-path: polygon(50% 0, 61% 18%, 82% 10%, 82% 32%, 100% 41%, 87% 58%, 98% 78%, 76% 80%, 70% 100%, 50% 88%, 30% 100%, 24% 80%, 2% 78%, 13% 58%, 0 41%, 18% 32%, 18% 10%, 39% 18%); }
/* The pop keyframes and the inline transform must use the SAME function list in the same order (scale then rotate), or the browser skips the interpolation and the sticker jumps to full size. */
@keyframes stick_pop { from { transform: scale(0) rotate(-40deg); } to { transform: scale(1) rotate(var(--rot, 0deg)); } }
```
```js
const stage = $('#stage');
const COLORS = ['#ffde59', '#ff90e8', '#90a8ed', '#b8ff9f', '#ff7a59', '#fff8e6'];
const WORDS = ['NEW', 'HOT', 'RAW', 'YES', 'LOUD', 'OK', 'BIG'];
const KINDS = ['round', 'label', 'burst', ''];
const pick = (a) => a[(Math.random() * a.length) | 0];
function add_sticker() {
  const el = document.createElement('div'), r = stage.getBoundingClientRect();
  el.className = 'sticker ' + pick(KINDS); el.textContent = pick(WORDS); el.style.background = pick(COLORS);
  el.style.left = rand(20, Math.max(40, r.width - 170)) + 'px'; el.style.top = rand(20, Math.max(40, r.height - 150)) + 'px';
  const rot = rand(-14, 14).toFixed(1) + 'deg';
  el.style.setProperty('--rot', rot); el.style.transform = `scale(1) rotate(${rot})`;   // same function list as the keyframes
  if ($$('.sticker', stage).length > 14) $('.sticker', stage).remove();                  // cap at 14, drop the oldest
  stage.appendChild(el); drag(el, stage);
}
for (let i = 0; i < 4; i++) add_sticker();
$('#add').addEventListener('click', add_sticker);
$('#clear').addEventListener('click', () => $$('.sticker', stage).forEach((s) => s.remove()));
const THEMES = { yellow: '#ffde59', pink: '#ff90e8', blue: '#90a8ed', mint: '#b8ff9f' };
seg($('#theme'), (b) => stage.style.setProperty('--acc', THEMES[b.dataset.theme]));
```
`drag` from the helpers sets `left` and `top` but a sticker rotated by `transform` keeps its rotation. `animation: stick_pop` uses `transform` in `from` only, so the inline rotation applies after the pop.
Ticker content, duplicated: `<div class="in"><span>Loud</span><span>Raw</span><span>Honest</span><span>Loud</span><span>Raw</span><span>Honest</span></div>`.
Add one row of real component samples to the stage so it feels like a design system: two `.nb_btn` and a toggle made of a 64x32 box with a 3px border and a 24px square knob that slides with `translateX` on click.

## Controls
button Add, button Clear, `seg` Yellow / Pink / Blue / Mint.

## Details that bite
- The ticker sits at the bottom, so the stage caption goes on the right and above it: `<span class="tag right" style="bottom: 70px">`, or leave the caption out.
- `.tag` is grey for dark stages. On cream paper override it in styles.css: `.nb ~ .tag, .stage.nb .tag { color: #000; }`.
- If a theme seg sets `--acc` and a bar also fills with `var(--acc)`, that bar vanishes when the stage background becomes the same color. Keep the stage background cream and let the bars and accents take `--acc`, or give the bar a fixed color.
- The 2 buttons and the toggle inside the stage are samples, each must still do something visible (press physics, the knob slides). They do not count toward the 2 to 4 controls under the stage.
- Cap stickers at 14.

## Pitfalls
- Blurred shadows, gradients or soft grays. Everything is flat and hard.
- All elements aligned and straight reads as boring. Rotate by 0.5 to 2 degrees and overlap.
- Thin 1px borders. It is 3px minimum.
- Low contrast pastels on pastels. Text is black.
- Only one font size. Use a huge size contrast, headline 100px plus, labels 14px.

## Done when
It looks like a loud, hand pasted poster: thick outlines, hard shadows, tilted color bars, black ticker, draggable stickers that pop in, buttons that physically press down.

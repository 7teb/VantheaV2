# Bauhaus

Look: flat geometric tiles in a strict grid. Paper `#f1ebdd`, red `#d62828`, yellow `#f2c230`, blue `#1d3fa5`, black `#111`. Circles, quarter discs, half discs, triangles, stripes, rings. No gradients, no shadows, no blur. Heavy sans type in uppercase (`Jost`, add `family=Jost:wght@500;700;800` to the fonts URL, fallback `Futura, 'Century Gothic', sans-serif`).
Stage: `<div class="stage bau">` with NO `h_md` or `h_lg` class. The grid of square tiles (`gap: 0`) sets the stage height. 8 columns on desktop, 5 under 760px.

## Technique
1. Every tile is a `div.t` with `--bg`, `--fg` (two different palette colors) and a shape class. The shape is drawn by `::before`.
2. Shapes with pure CSS: circle, quarter (corner disc), half (half disc), tri (clip-path), bars (repeating gradient), ring (border), square.
3. Tiles rotate in 90 degree steps (`--rot`). Click a tile to turn it. Every 900ms one random tile turns by itself, but ONLY pick from tiles whose shape changes when turned (quarter, half, tri, bars). A circle, square or ring looks the same after a turn, so the board would seem frozen. Also give the focal block a slow ambient motion, for example the rosette turning 30 degrees per second.
4. Shuffle regenerates all tiles with a diagonal stagger.
5. Neighbour rule: if a tile has the same background as the one on its left, pick another. Keep an array `bgs[]` of the chosen backgrounds by index, and compare with `bgs[i - 1]` when `i % cols` is not 0. Do not read the DOM sibling, the word block is also a child of the grid.
5b. Balance: weight the color pick so red and yellow lean to the top left and blue to the bottom right (light from the top left). A plain uniform pick can leave the board lopsided.
6. Tiles are square (`aspect-ratio: 1`) and the grid sets the stage height. So do NOT put `h_md` or `h_lg` on this stage. Use `<div class="stage bau">` only.

## Code
```css
.bau { height: auto; background: #f1ebdd; }
.grid { display: grid; grid-template-columns: repeat(var(--cols, 8), 1fr); }
.t { --bg: #f1ebdd; --fg: #d62828; --rot: 0deg; position: relative; aspect-ratio: 1; overflow: hidden; cursor: pointer; background: var(--bg);
  transform: rotate(var(--rot)); transition: transform .55s var(--ease), background-color .3s var(--ease); }
.t::before { content: ''; position: absolute; background: var(--fg); transition: background-color .3s var(--ease); }
.t.circle::before { inset: 12%; border-radius: 50%; }
.t.quarter::before { inset: 0; border-radius: 100% 0 0 0; }
.t.half::before { left: 0; right: 0; top: 0; height: 50%; border-radius: 999px 999px 0 0; }
.t.tri::before { inset: 0; clip-path: polygon(0 100%, 100% 100%, 0 0); }
.t.bars::before { inset: 0; background: repeating-linear-gradient(90deg, var(--fg) 0 16.66%, transparent 16.66% 33.33%); }
.t.ring::before { inset: 10%; border-radius: 50%; background: transparent; border: 14px solid var(--fg); }
.t.square::before { inset: 26%; }
.bau_word { font: 800 clamp(28px, 6vw, 72px)/1 Jost, Futura, 'Century Gothic', sans-serif; text-transform: uppercase; letter-spacing: .02em; }
```
```js
const PALETTES = {
  primary: ['#d62828', '#f2c230', '#1d3fa5', '#111111', '#f1ebdd'],
  mono: ['#111111', '#f1ebdd', '#8a8578', '#d9d2c0', '#f1ebdd'],
  earth: ['#c8553d', '#e0a458', '#2d5d5a', '#2b2118', '#efe6d2'],
};
const SHAPES = ['circle', 'quarter', 'half', 'tri', 'bars', 'ring', 'square'];
const pick = (a) => a[(Math.random() * a.length) | 0];
let pal = PALETTES.primary, cols = 8;
const grid = $('#grid');
const bgs = [];                                   // chosen background per cell index, band cells hold '#111111'
function build() {
  grid.style.setProperty('--cols', cols); grid.querySelectorAll('.t').forEach((t) => t.remove()); bgs.length = 0;
  const rows = Math.round(cols * .62), band_cells = cols <= 5 ? 2 : 6, n = cols * rows - band_cells;
  for (let k = 0; k < band_cells; k++) bgs.push('#111111');
  for (let i = band_cells; i < band_cells + n; i++) {
    const t = document.createElement('div'); t.className = 't'; t.rot = 0;
    t.addEventListener('click', () => turn(t)); grid.appendChild(t); roll(t, i);
  }
}
function roll(t, i) {
  const left = i % cols ? bgs[i - 1] : '';       // compare by index, never by DOM sibling
  let bg = pick(pal), tries = 0; while (bg === left && tries++ < 6) bg = pick(pal);
  bgs[i] = bg;
  let fg = pick(pal); tries = 0; while (fg === bg && tries++ < 6) fg = pick(pal);
  t.className = 't ' + pick(SHAPES); t.style.setProperty('--bg', bg); t.style.setProperty('--fg', fg);
  t.rot = ((Math.random() * 4) | 0) * 90; t.style.setProperty('--rot', t.rot + 'deg');
}
function turn(t) { t.rot += 90; t.style.setProperty('--rot', t.rot + 'deg'); }
let acc = 0;
animate_when_visible(grid, (t, dt) => {
  acc += dt;
  if (acc > .9) { acc = 0; const k = $$('.t.quarter, .t.half, .t.tri, .t.bars', grid); if (k.length) turn(k[(Math.random() * k.length) | 0]); }   // only shapes where a turn is visible
});
function shuffle() { $$('.t', grid).forEach((t, j) => { const i = j + (cols <= 5 ? 2 : 6); setTimeout(() => roll(t, i), ((i % cols) + Math.floor(i / cols)) * 45); }); }
```
Use `const bgs = []` for the neighbour rule as described in rule 5, and fill `bgs[i]` inside `roll`.
Focal block: ONE extra element that is NOT a `div.t`, so roll, shuffle and the idle turn never touch it: `<div class="band">` as a grid child with `grid-column: 1 / span 3; grid-row: 1 / span 2`, black background, containing the word in paper color (`display: grid; place-items: center; container-type: size`) with `font-size: min(10cqw, 26cqh)` and, if the browser lacks container units, a `clamp(28px, 6vw, 72px)` fallback inside `@supports not (width: 1cqw)`.
Tile count: `cols * rows - band_cells`, where `rows = Math.round(cols * .62)` and `band_cells` is 6 (3 by 2). At 5 columns or fewer make the band 2 by 1 (`band_cells = 2`), or it covers half the board. Skip the band's cells when numbering tiles for the neighbour rule (put band cells into `bgs` as `#111`).
Under 760px set `cols` to 5. Pick `cols` at load with `const mobile = matchMedia('(max-width: 760px)')`, and rebuild when it changes: `mobile.addEventListener('change', () => { cols = mobile.matches ? 5 : +$('#density').value; build(); })`.
Band cells occupy the FIRST indices of `bgs` (0 to `band_cells - 1`), which is why `roll` starts counting at `band_cells`. The band CSS, exactly:
```css
.band { grid-column: 1 / span 3; grid-row: 1 / span 2; background: #111111; color: #f1ebdd; display: grid; place-items: center; container-type: size; overflow: hidden;
  font: 800 min(10cqw, 26cqh)/1 Jost, Futura, 'Century Gothic', sans-serif; text-transform: uppercase; letter-spacing: .02em; }
@supports not (width: 1cqw) { .band { font-size: clamp(28px, 6vw, 72px); } }
.bau.compact .band { grid-column: 1 / span 2; grid-row: 1 / span 1; }   /* add the class compact on .bau when cols <= 5 */
```
The card's JS is shown as loose top level code to keep it short. In your `app.js` wrap it in `init()` like every other style.

## Controls
button Shuffle, `seg` Primary / Mono / Earth, slider Density 4 to 12 (rebuilds).

## Pitfalls
- Gradients, shadows or rounded corners on the tiles ruin the style. Flat only.
- Random colors with no rule look like a children's toy. The palette is the rule, keep black rare.
- Tile rotation with `transform` on a non square tile will overflow. Keep tiles square.
- `border: 14px` for the ring must be on a pseudo element, it is allowed inside a stage.

## Done when
A tight grid of primary color geometry with obvious Bauhaus character, tiles quietly turn by themselves, clicking turns one, Shuffle sweeps diagonally.

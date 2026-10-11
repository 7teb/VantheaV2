# Blueprint

Look: a technical drawing on cyanotype paper. Blue `#0f3b78`, fine white grid (major 80px, minor 16px), white and pale cyan `#bfe6ff` linework, dashed center lines, dimension arrows, small mono labels, a title block in the corner. Lines draw themselves on, then a gear turns slowly.
Stage: `.stage.h_lg` with the blueprint background below. One SVG fills it. A crosshair with a live coordinate readout follows the pointer.

## Technique
1. Paper: layered `linear-gradient` grids on `#0f3b78` plus a soft light vignette.
2. Linework: `stroke: #dff2ff`, 1.5px, `fill: none`, `vector-effect: non-scaling-stroke`. Hidden lines `stroke-dasharray: 8 5`, center lines `stroke-dasharray: 18 4 3 4`.
3. Draw on: give each path `pathLength="1"`, set `stroke-dasharray: 1; stroke-dashoffset: 1` and animate the offset to 0 with a staggered `--d` delay. Remove the dash after to avoid dotted artifacts in dashed styles.
4. The gear path is generated in JS. Teeth are trapezoids.
5. Dimension line: a line with arrow markers at both ends and a mono label centered over it.
6. Click drops a numbered callout (circle plus leader line) at that spot.

## Code
```css
.bp { background-color: #0f3b78;
  background-image:
    radial-gradient(70% 70% at 50% 45%, rgba(255,255,255,.1), transparent),
    linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
  background-size: auto, 80px 80px, 80px 80px, 16px 16px, 16px 16px; background-position: 0 0, center, center, center, center; }
.bp svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ln { fill: none; stroke: #dff2ff; stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
.ln.thin { stroke-width: 1; stroke: #bfe6ff; }
.ln.center { stroke-dasharray: 18 4 3 4; stroke: #8fd0ff; }
.ln.hidden { stroke-dasharray: 8 5; stroke: #bfe6ff; }
.ln.dash { stroke-dasharray: 8 5; }
/* Draw on. Every path needs pathLength="1". The draw class must win over the dashed classes while it runs, then the real dash comes back. */
.draw, .ln.center.draw, .ln.hidden.draw, .ln.dash.draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.8s var(--ease) forwards; animation-delay: var(--d, 0s); }
@keyframes draw { to { stroke-dashoffset: 0; } }
/* Static labels must not float in empty paper before their box is drawn. Same --d delay as the lines. */
.t_in { opacity: 0; animation: t_in .5s var(--ease) forwards; animation-delay: calc(var(--d, 0s) + 1.2s); }
@keyframes t_in { to { opacity: 1; } }
.spin { transform-box: fill-box; transform-origin: center; animation: spin 90s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.t_mono { font: 500 12px var(--mono); fill: #dff2ff; letter-spacing: .06em; }
.cross { position: absolute; inset: 0; pointer-events: none; }
.cross i { position: absolute; background: rgba(223,242,255,.55); }
.cross .h { left: 0; right: 0; height: 1px; } .cross .v { top: 0; bottom: 0; width: 1px; }
.readout { position: absolute; padding: 3px 8px; font: 500 12px var(--mono); color: #dff2ff; background: rgba(8,36,80,.8); border-radius: 6px; pointer-events: none; }
```
```js
function gear_path(cx, cy, teeth, ro, ri) {
  const step = TAU / teeth; let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[ri, a], [ro, a + step * .14], [ro, a + step * .36], [ri, a + step * .5]];
    pts.forEach(([r, ang], k) => { d += (i === 0 && k === 0 ? 'M' : 'L') + (cx + r * Math.cos(ang)).toFixed(1) + ' ' + (cy + r * Math.sin(ang)).toFixed(1); });
  }
  return d + 'Z';
}
```
Markup in one SVG, `viewBox="0 0 1000 560"` and `preserveAspectRatio="xMidYMid meet"`:
- `<defs>` with `<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#dff2ff"/></marker>`
- Group `#gear_g class="spin"` with the gear path (`#gear`), a hub circle r 36, 6 bolt hole circles on radius 72 (r 9), a root circle r 120 (`thin`, dashed).
- Center lines: horizontal and vertical through the gear center, `.center`.
- Dimension line under the gear, `marker-start` and `marker-end` set to `url(#arr)`, label `Ø 300` in `.t_mono`.
- A side view rectangle on the right with hidden lines (dashed) and its own dimension.
- Title block bottom right: a rect 260 by 90 with 3 rows. Labels `DRAWING`, `SCALE 1:2`, `SHEET 1 OF 1`, `REV A`, each text with class `t_mono t_in` and a `--d` after the rect's. These are generic, no invented company names.
Regenerate: `$('#gear').setAttribute('d', gear_path(500, 270, teeth, 150, 124))`. Teeth slider 8 to 24. Redraw: remove the `draw` and `t_in` classes from every path and label, force a reflow with `void svg.clientWidth` (an SVG element has NO `offsetWidth`, so that line does nothing), then add the classes again. After each path finishes (`animationend`), remove `draw` from it so its real dash (center, hidden, root circle) comes back. Give each element a `--d` delay by order (0s, .15s, .3s ...) so the sheet writes itself in sequence.
Pointer to drawing units: the SVG is letterboxed by `meet`, so a plain `x / w * 1000` is wrong. Convert with the SVG matrix:
```js
const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
const d = pt.matrixTransform(svg.getScreenCTM().inverse());     // d.x, d.y are in 0..1000 and 0..560 drawing units
readout.textContent = `X ${d.x.toFixed(1)}  Y ${d.y.toFixed(1)}`;
```
Crosshair lines and the readout are DOM elements positioned with the raw pointer position inside the stage, smoothed with `damp`. When the pointer is away let the crosshair drift slowly on its own.
Callouts: on click, convert the pointer with the same matrix, append to a `<g id="notes">` a circle r 11 at `d.x, d.y` and a number text, increment a counter, add a short leader line to the gear center (500, 270). Clear empties the group and resets the counter.
Timing note: a full draw on takes about 3.4 seconds, so a screenshot early in the load shows a half drawn sheet. That is expected.

## Controls
slider Teeth 8 to 24, toggle Grid (switch `background-image` off via a class), button Redraw, button Clear (remove callouts).

## Pitfalls
- Without `pathLength="1"` the dash trick needs real lengths, small models get it wrong. Always set it.
- Keep `vector-effect: non-scaling-stroke`, otherwise lines get fat when the SVG scales.
- Too much white makes it garish. Fine 1 to 1.5px lines, big empty spaces.
- Draw text in the SVG, not DOM, so it scales with the drawing.

## Done when
Lines write themselves in sequence, the gear then turns slowly, the crosshair reads coordinates, clicking numbers a callout, changing teeth regenerates a valid gear.

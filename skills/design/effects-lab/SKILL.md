---
name: effects-lab
description: Build polished visual effect pages as plain HTML, CSS and JS. Mode A builds one style page (particles, liquid morph, holographic, neon glow, wireframe 3d, glassmorphism, kinetic type, isometric, clay3d, ascii art, gradient mesh, comic book, split flap display, retro vhs, halftone, bauhaus, pixel art, blueprint, art deco, neo brutalism). Mode B composes a short scene based ad out of 2 or 3 of those effects with one shared palette and four lines of copy. Use it when the task asks for one of these effects as its own page, an effect or design showcase page, or a composed animated ad. Not for regular app UI, components or restyling an existing site. Written for small models. Follow it step by step and do not improvise the structure.
---

# Effects Lab

Pick the mode from the task.
- Mode A, one style page. The task names one style. The page has a calm dark frame and a stage. The stage is the world of the style. The frame never changes, the stage changes completely.
- Mode B, a composed ad. The task says ad, compose, scene, campaign, or names a subject and several effects. Read `styles/compose.md` FIRST (read_skill with this skill's name and file `styles/compose.md`) and follow it. It has its own steps (brief, layers, scenes). The rules below about the frame, the stage points, the code and the checker still apply to it.

Folder: SKILL_DIR, the absolute skill folder that the read_skill result names (`Skill folder: ...`). It ships with VantheaX and is read only: never edit or write anything in it and never put OUT inside it.
- `kit/` files you copy and never edit (base.css, helpers.js, template.html, and for ads ad.css and template_ad.html)
- `styles/<name>.md` one recipe card per style, with working code. `styles/compose.md` is the card for Mode B. Read a card with read_skill, this skill's name and file `styles/<name>.md` as listed in the read_skill result.
- `tools/scaffold.py` sets up the output folder. `tools/check.py` is the checker you run before you report.

Run every command with run_command from the project root, so OUT lands in the project. Put SKILL_DIR paths in double quotes, the install path can contain spaces. It needs python with Pillow, node 22 or newer, and Edge or Chrome for the checker.

## Procedure for Mode A (do all steps in this order)

1. Read the card `styles/<name>.md` for your style (read_skill, file `styles/<name>.md`). Read it fully. The code in it works, start from it.
2. Set up the output folder with one command. OUT is the folder the task names. If the task names none, use `out/<name>`.
   `python "SKILL_DIR/tools/scaffold.py" <name> OUT`
   It copies base.css and helpers.js, writes index.html with the style number, the title, the label and the right stage class already filled in, and creates styles.css and app.js with a TODO marker. The checker fails until you replace every TODO marker.
3. Edit `index.html`. The title, number and label are already set. Change the LABEL if you want a better two word caption such as `Torus` or `Tape 04` (it is the `.tag` text). Add the stage markup from the card. Add the stage font to the Google Fonts URL if the card names one. Keep `base.css` before `styles.css` and `helpers.js` before `app.js`.
4. Write `styles.css`. Stage styles go here. The chrome is already done by base.css. Tiny chrome overrides are allowed here too, but only for what base.css lacks, and never by editing base.css. base.css already provides: `.tag` (bottom left, add class `right` to move it to the bottom right when the stage has something in the left corner), `.btn[aria-pressed='true']` for toggle buttons, `.seg`, `.range`, `.swatches`, `.field`, `.skeleton`.
5. Write `app.js`. Use the helpers. The card's JS is a starting point. Put it inside one `init()` function (or a few named functions) and call it at the bottom. If the card shows loose top level code, wrap it. If the card and this file disagree, this file wins, except for numbers and technique details inside the card's code, which win over your memory.
6. Check syntax: `node --check OUT/app.js`
7. Run the checker: `python "SKILL_DIR/tools/check.py" OUT` with timeout_ms 240000 on run_command (the default 30 seconds kills it) and fix every FAIL. Read every WARN and fix the ones that apply.
8. Report in three lines: what you built, the checker result, anything you could not finish.

Never skip step 6 and 7. Never say it works without running them. If the checker says it could not run a browser, that is a FAIL, not a pass: fix the setup (install Edge or Chrome, node 22 or newer, `pip install pillow`) or report plainly that nothing was verified.

## Procedure for Mode B (a composed ad)
1. Read `styles/compose.md` fully.
2. `python "SKILL_DIR/tools/scaffold.py" compose OUT`
3. Write `OUT/brief.md` (subject, mood, palette, layers, four lines of copy, scenes). Do this before any code. The checker reads it.
4. Fill `index.html` (copy into the slots, keep the slot classes, set `data-show` per slot, one button per scene in `#scenes`).
5. Write `styles.css` (the palette as `--c1` to `--c5` on `.ad`, plus the CSS of your layers) and `app.js` (timeline, layers, one loop, controls) as shown in the card.
6. `node --check OUT/app.js`, then `python "SKILL_DIR/tools/check.py" OUT` with timeout_ms 240000 on run_command. Fix every FAIL.
7. Look at the scene screenshots the checker saves (`OUT/_shots/scene_*`) with PIL: is the hero large and in the right place, does each scene differ, does the copy read. The checker takes 40 to 120 seconds for an ad, because it plays the scenes. Set timeout_ms on run_command to at least 240000, the default 30 seconds kills it. The `narrow` and `phone` shots are page shots taken after the controls were used, so judge the ad from the `scene_*` shots and the `wide_*` shots.
8. Report in four lines: subject and layers, scenes, checker result, anything unfinished.

Stage points 1 to 6 below apply to the whole ad. In a composed ad there is exactly one focal thing at a time, and layers must not fight each other.

## The frame (never break)

- Chrome means everything outside `.stage`: title, label, controls, buttons. It uses base.css only.
- No 1px outlines on cards, inputs or buttons in the chrome. Surfaces are pressed in with the inset shadows from base.css.
- No emoji anywhere. No em dashes anywhere (use a comma or a period). No icon fonts. Icons are inline SVG with `stroke-width: 1.75`, round caps, `currentColor`, class `i`.
- No light/dark theme toggle in the chrome. A style's own palette or mode switch under the stage (for example Gold / Emerald / Rose, or Pastel / Candy / Mono) is a normal control and is allowed. No marketing sentences under the title. Labels are nouns, buttons are verbs. Two or three words.
- No fake logos, fake brands, fake people. If an asset does not exist leave the slot empty.
- Weights 400 to 800 in the chrome. Thin and black weights are allowed only inside the stage.
- Controls: 2 to 4 per page. Every control must visibly change the stage the moment it is used.

## The stage (where you win)

The stage is judged on these six points. Check each one before you report.

1. One focal thing. A viewer must know in one second where to look. Everything else supports it.
2. It moves on its own. Idle motion from time (`t / 1000`), never a frozen picture. Slow and smooth, 6 to 20 second loops for ambient motion.
3. It answers the pointer. Hover, move or press changes it with smoothing (use `damp`), never a hard jump.
4. Real depth. Layers, shadows, blur, overlap, light direction. Light comes from the top left, always.
5. Restraint. A palette of 3 to 5 colors from the card. No random extra colors. Large empty space is fine.
6. Craft details. A texture, a highlight, a tiny label in mono, a vignette or grain. Small things that make it feel made by hand.

Motion rules:
- Easing: `var(--ease)` for CSS transitions, 120 to 320 ms. Nothing bounces unless the card says so (clay, neo brutalism, comic).
- Loops that run forever use `linear` or sine. One shot motion uses ease out. The 6 to 20 second rule is for ambient drift. Mechanical loops the card names (a 1.2s grid scroll, a spinner, a marquee) keep the card's timing, and you add one slow ambient motion next to them.
- Low resolution canvases that a card asks for (a 160x90 static field, an 80x50 mesh, a 90 row pixel scene) are allowed, because the low resolution is the technique. Size them exactly as the card says and set `image-rendering` as the card says. Every other visible canvas goes through `fit_canvas`.
- Time values you get from `animate_when_visible` are safe. Anything you accumulate yourself must still be clamped (`Math.max(0, ...)`), and array indexes made from time must use a wrapped modulo `((n % m) + m) % m`.
- A page can pass the checker and still be broken in one mode or at one width. After the checker passes, test every mode of the card at least once (change the default in `app.js`, run, restore) and look at the 800px shot too.
- Every `requestAnimationFrame` loop goes through `animate_when_visible`. Never call `requestAnimationFrame` yourself.
- Canvas always through `fit_canvas`. Draw in CSS pixels with `c.w` and `c.h`. The `onresize` callback runs only after the first layout, never during the call, so build your size dependent data in a named function and also call it once yourself after `fit_canvas` returns. Never read `c` inside code that runs before the `const c = fit_canvas(...)` line finishes.
- Order of declarations: declare every `const` and `let` that a function reads before you call anything that may run that function.
- Never create objects or arrays inside a hot loop if you can reuse them. Cap particle or element counts as the card says.

## Code rules

- snake_case for your own functions, variables, ids, classes (`draw_scene`, `p_count`). camelCase only where the DOM forces it.
- Plain files. No frameworks, no npm, no CDN scripts, no build step.
- The ids in `app.js` must exist in `index.html`. After writing, grep both files and compare. The checker also does this.
- Do not use `100vh` for the stage height. Use the `h_md` or `h_lg` class.
- Give the stage `position: relative` (the `.stage` class already does) and put absolute children inside it.
- For templates in JS use backticks only for one line strings. Close every bracket. Keep functions under 60 lines.
- Controls read state through variables, not by querying the DOM every frame.
- Start with the card's code and change it. Do not rewrite the technique from memory.

## Common mistakes of small models (read twice)

- Canvas is blank because width and height are 0. Fix: use `fit_canvas` and give the canvas `class="fill"` inside a stage with a height class.
- Effect appears only after resize. Fix: draw in the frame function, not once at load.
- Buttons do nothing because ids differ between HTML and JS. Fix: compare ids.
- Page loads but nothing moves. Fix: you forgot to call `init()`, or the loop never starts because the element has zero size.
- `backdrop-filter` shows nothing. Fix: there must be colorful content behind the element inside the same stage, and no ancestor with `opacity < 1` or `filter`.
- CSS animations or transitions that look like they should work but jump: the `from` and `to` transform lists must use the same functions in the same order (`scale() rotate()` against `scale() rotate()`). A mismatch makes the browser swap the value in one step.
- Forcing a reflow to restart an animation: use `void el.offsetWidth` on HTML elements and `void svg.clientWidth` on SVG elements (SVG has no offsetWidth).
- Converting a pointer to SVG units: use `svg.getScreenCTM().inverse()`, never a plain ratio, because `preserveAspectRatio` letterboxes the drawing.
- The Google Fonts link in the template blocks rendering while it loads. On a machine without network it can delay the first paint by about a second. That is normal, keep the fallback stacks.
- The canvas is blank in some screenshots only. The visibility observer can fire late, so after `animate_when_visible(...)` call your frame function once yourself, for example `frame(performance.now(), 0.016)`.
- Text is unreadable because the effect is too bright. Fix: put a dark scrim behind or lower the intensity.
- Everything is the same size and evenly spaced, which looks flat. Fix: vary scale by a factor of 3 or more, and let the focal element be large.
- `await animation.finished` chains are fine in a real browser, but a flap or panel that holds its last keyframe can cover what is under it. After a sequenced animation call `animation.cancel()` and pin the settled state with an inline style.
- You add a long explanation paragraph. Fix: delete it. Labels only.
- Gradients in rainbow order everywhere. Fix: pick the card's palette and stay in it.
- You edit `base.css` or `helpers.js`. Fix: do not. Put overrides in `styles.css`.

## Checker output guide

The checker opens the page in a real browser with a real clock. It waits, takes shots, moves the mouse over the stage, presses it, then clicks, drags and types into every control, and finally resizes to 800 and 390 wide. It takes about 20 to 40 seconds. Run it again after every fix.

- `FAIL runtime: exception app.js:LINE ...` a JS error that happened while loading, idling, or using a control. The line number is real. Fix it first. `(xN)` means it fired N times, which usually means it is inside the frame loop.
- `FAIL app.js uses #x but index.html has no element with that id` add the id or fix the name.
- `FAIL screenshot is almost one flat color` the stage is blank. Usually a zero size canvas or a missing call to `init()`.
- `FAIL N canvas has zero size` give the canvas `class="fill"` inside a stage that has a height class.
- `FAIL page scrolls sideways at 800 wide` something is wider than the screen. Add a media query or `min-width: 0`.
- `FAIL ... leftover TODO marker` or `still has the template placeholder X` replace the scaffold text with real content.
- `FAIL brief.md ...` (Mode B) the brief breaks a rule: word limits, a world style, a role not allowed, a palette color not in styles.css, scenes over 16 seconds, a layer in the brief that is not in the code. The message says which.
- `FAIL the timeline never left scene 0` the scenes do not advance. Check the `dur` values and that `timeline(...)` is called with the `.ad` element.
- `WARN the scenes look identical` each scene must change something visible: slots (`data-show`), the mood of the layers, or the layout.
- `FAIL ... NOTHING was verified in a browser` the browser part could not run. Fix the setup, never ignore it.
- `WARN nothing moves on its own when the pointer is away` add idle motion from time, or the loop is not running.
- `WARN fewer than 2 controls ...` your controls are not inside `.controls`.
- `WARN only N distinct colors` the stage is too flat, add depth, gradients, light and texture.
- The numbers `colors` and `edges` depend on the moment of the screenshot, so they are a smoke test and not a quality score. Judge quality with the six stage points above.
- A very dark stage (wireframe, particles, neon) sits close to the flat color limit. Faint glows, a vignette, a floor, or grain keep it safely above.
- The checker cannot see whether it looks good. It cannot tell a wrong face shade, a clipped shape, or an invisible effect. After it passes, open the PNG files in `OUT/_shots/` and test the details the card's "Done when" line names, for example by reading pixels with PIL (are the three face tones there, is the grid visible, is the shape inside the stage).
- Do not add an effect just to make a checker number pass. The page must be right on its own.

Screenshots are saved in `OUT/_shots/` (`wide_a`, `wide_still`, `wide_b`, `narrow`, `phone`). Leave that folder, delete scratch files you created.
Read the shots in this order of meaning: `wide_a` and `wide_still` show the default state (about 3 seconds after load, then 1.5 seconds later). `wide_b` is after the mouse moved over the stage. `narrow` (800) and `phone` (390) are taken AFTER every control was clicked and dragged, so they show the last state of each control, not the default. A page that looks broken only in `narrow` may just be in its last mode, so check that before you change code. The first browser launch can be slow on a cold profile, so do not panic at a slow first run.

## Style list

01 particles, 02 liquid_morph, 03 holographic, 04 neon_glow, 05 wireframe_3d, 06 glassmorphism, 07 kinetic_type, 08 isometric, 09 clay_3d, 10 ascii_art, 11 gradient_mesh, 12 comic_book, 13 split_flap, 14 retro_vhs, 15 halftone, 16 bauhaus, 17 pixel_art, 18 blueprint, 19 art_deco, 20 neo_brutalism

Card file for each is `styles/<name>.md`. The number is the NN you put in `index.html`.

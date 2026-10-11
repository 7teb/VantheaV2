'use strict';
/* helpers.js : copy as is. Never edit. Everything is a plain global function. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
/* frame rate independent smoothing: x = damp(x, target, 8, dt) */
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const TAU = Math.PI * 2;

/* Runs frame(t_ms, dt_s) only while el is on screen. dt is capped at 0.05. Returns nothing. */
function animate_when_visible(el, frame) {
  let raf = 0, visible = false, last = -1;
  const tick = (t) => {
    if (!visible) return;
    /* last is seeded from the first rAF timestamp, never from performance.now(), because the two clocks can differ.
       dt is always between 0 and 0.05, so it is safe to accumulate and to use as a divisor guard. */
    const dt = last < 0 ? 0.016 : Math.min(0.05, Math.max(0, (t - last) / 1000));
    last = t;
    frame(t, dt);
    raf = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    cancelAnimationFrame(raf);
    if (visible) { last = -1; raf = requestAnimationFrame(tick); }
  }).observe(el);
}

/* Pointer state relative to el: { x, y, inside, down, nx, ny } where nx, ny run 0..1 */
function pointer_in(el) {
  const p = { x: 0, y: 0, nx: 0.5, ny: 0.5, inside: false, down: false };
  const set = (e) => {
    const r = el.getBoundingClientRect();
    p.x = e.clientX - r.left; p.y = e.clientY - r.top;
    p.nx = clamp(p.x / r.width, 0, 1); p.ny = clamp(p.y / r.height, 0, 1);
  };
  el.addEventListener('pointerenter', (e) => { set(e); p.inside = true; });
  el.addEventListener('pointermove', (e) => { set(e); p.inside = true; });
  el.addEventListener('pointerleave', () => { p.inside = false; p.down = false; });
  el.addEventListener('pointerdown', (e) => { set(e); p.inside = true; p.down = true; });
  window.addEventListener('pointerup', () => { p.down = false; });
  return p;
}

/* Sizes a canvas to its CSS box with DPR up to 2. Returns { ctx, w, h } and keeps them live.
   Use c.w and c.h (CSS pixels) for all drawing. onresize is optional. */
function fit_canvas(canvas, onresize) {
  const ctx = canvas.getContext('2d');
  const c = { ctx, w: 0, h: 0, dpr: 1 };
  const resize = (notify) => {
    const r = canvas.getBoundingClientRect();
    c.dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.w = Math.max(1, r.width); c.h = Math.max(1, r.height);
    canvas.width = Math.round(c.w * c.dpr); canvas.height = Math.round(c.h * c.dpr);
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    if (notify && onresize) onresize(c);
  };
  /* The first size is set silently, because the caller's `const c = fit_canvas(...)` does not exist yet and
     onresize would hit a temporal dead zone error. The observer below fires onresize right after the first layout. */
  resize(false);
  new ResizeObserver(() => resize(true)).observe(canvas);
  return c;
}

/* Exclusive segmented control. root holds buttons, cb(button) runs on change. First press state comes from the HTML. */
function seg(root, cb) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    $$('button', root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    cb(b);
  });
}

/* Range input with a live <output>. Runs cb once now and on every input. */
function slider(input, output, cb) {
  const run = () => { if (output) output.textContent = input.value; cb(+input.value); };
  input.addEventListener('input', run);
  run();
}

/* On off button using aria-pressed. cb(is_on) */
function toggle(btn, cb) {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    cb(on);
  });
}

/* Makes el draggable inside box (the stage). Sets left and top in px. */
function drag(el, box) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      el.style.left = clamp(ev.clientX - b.left - ox, 0, b.width - r.width) + 'px';
      el.style.top = clamp(ev.clientY - b.top - oy, 0, b.height - r.height) + 'px';
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}

/* Smooth value noise in 0..1. noise2(x, y) */
const noise2 = (() => {
  const P = new Uint8Array(512);
  for (let i = 0; i < 256; i++) P[i] = i;
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [P[i], P[j]] = [P[j], P[i]]; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const f = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const a = P[P[X] + Y] / 255, b = P[P[X + 1] + Y] / 255, c = P[P[X] + Y + 1] / 255, d = P[P[X + 1] + Y + 1] / 255;
    return lerp(lerp(a, b, f(xf)), lerp(c, d, f(xf)), f(yf));
  };
})();

/* ---------- scenes and timeline (for ads and any page that tells a short story) ---------- */

/* Easing, every function takes t in 0..1 and returns 0..1 (back overshoots a little on purpose). */
const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  inout: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
/* Window inside a progress value: smooth(.2, .6, p) is 0 until p = .2, eases to 1 at p = .6, stays 1. */
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* Shared palette. Reads the CSS variables --c1 .. --c5 from el and returns them as an array of color strings.
   Every layer of a composed scene takes its colors from here so the whole piece shares one palette. */
function palette(el) {
  /* Without an argument it reads from the ad (.ad), because that is where --c1 to --c5 are set. */
  const src = el || document.querySelector('.ad') || document.documentElement;
  const cs = getComputedStyle(src);
  const pal = [1, 2, 3, 4, 5].map((i) => cs.getPropertyValue('--c' + i).trim()).filter(Boolean);
  if (pal.length < 5) console.error('palette(): found ' + pal.length + ' of 5 colors. Set --c1 to --c5 on .ad in styles.css.');
  return pal;
}

/* Runs a list of scenes one after another on a clock, only while host is on screen.
     scenes: [{ dur: seconds, mood: 0..1, enter(tl), update(p, dt, tl) }, ...]  (enter, update and mood are optional)
     opts:   { loop: true, dots: <.seg element>, on_scene(index, scene) }
   What it gives you:
     tl.index, tl.p (0..1 inside the scene), tl.time (seconds in the scene), tl.mood (smooth number, eases toward the scene's mood)
     tl.goto(i), tl.restart(), tl.pause(), tl.play()
   What it sets on host, so CSS can react without any JS:
     data-scene="N"   --scene: N   --p: 0..1   --mood: 0..1
   It shows and hides slots: any element inside host with data-show="0 2" gets the class "on" only while scene 0 or 2 is active.
   If opts.dots is a .seg element, its buttons (in scene order) show the active scene and jump to a scene when clicked. */
function timeline(host, scenes, opts = {}) {
  const loop = opts.loop !== false;
  const list = scenes.map((s) => (typeof s === 'number' ? { dur: s } : s));
  const tl = { index: -1, p: 0, time: 0, mood: list[0].mood || 0, playing: true, scenes: list };
  const slots = $$('[data-show]', host).map((el) => ({ el, show: el.dataset.show.trim().split(/\s+/) }));
  const dots = opts.dots ? $$('button', opts.dots) : [];

  function enter(i) {
    tl.index = i; tl.time = 0; tl.p = 0;
    host.dataset.scene = String(i); host.style.setProperty('--scene', i);
    slots.forEach((s) => s.el.classList.toggle('on', s.show.includes(String(i))));
    dots.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    if (list[i].enter) list[i].enter(tl);
    if (opts.on_scene) opts.on_scene(i, list[i]);
  }
  tl.goto = (i) => enter(clamp(i, 0, list.length - 1));
  tl.restart = () => { tl.playing = true; enter(0); };
  tl.pause = () => { tl.playing = false; };
  tl.play = () => { tl.playing = true; };
  dots.forEach((b, k) => b.addEventListener('click', () => { tl.goto(k); tl.playing = true; }));

  function step(dt) {
    const sc = list[tl.index];
    if (tl.playing) {
      tl.time += dt;
      if (tl.time >= sc.dur) {
        if (tl.index < list.length - 1) enter(tl.index + 1);
        else if (loop) enter(0);
        else tl.time = sc.dur;
      }
    }
    const cur = list[tl.index];
    tl.p = clamp(tl.time / cur.dur, 0, 1);
    tl.mood = damp(tl.mood, cur.mood || 0, 2.5, dt);
    host.style.setProperty('--p', tl.p.toFixed(3));
    host.style.setProperty('--mood', tl.mood.toFixed(3));
    if (cur.update) cur.update(tl.p, dt, tl);
  }
  enter(0); step(0);
  animate_when_visible(host, (t, dt) => step(dt));
  return tl;
}

/* Fade sections in once when they enter the viewport. Give them class="reveal". */
function reveal_on_scroll() {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.04 });
  $$('.reveal').forEach((el) => io.observe(el));
}
reveal_on_scroll();

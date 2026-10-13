export const two_frames = "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))";

export const find_scene_host = "(() => { const h = document.querySelector('[data-scene]'); if (!h) return false; h.scrollIntoView({block:'center'}); return true; })()";

export const current_scene = "(document.querySelector('[data-scene]') || {dataset:{}}).dataset.scene";

export const scroll_top = "window.scrollTo(0, 0)";

export const find_stage =
  "(() => { const s = document.querySelector('.stage, .ad'); if (!s) return null; s.scrollIntoView({block:'center'}); const r = s.getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()";

export const stage_box = "(() => { const r = document.querySelector('.stage, .ad').getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()";

export const list_controls = `(() => {
    const out = [];
    document.querySelectorAll('.controls button, .controls input, .controls select, .stage button, .ad button').forEach((el, i) => {
      el.dataset.live = i; const r = el.getBoundingClientRect(); out.push({ i, tag: el.tagName, type: el.type || '', w: r.width, h: r.height });
    }); return out; })()`;

export const scroll_to_control = (index: number) =>
  `(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('[data-live="${index}"]').scrollIntoView({block:'center'}); })()`;

export const control_box = (index: number) =>
  `(() => { const r = document.querySelector('[data-live="${index}"]').getBoundingClientRect(); return {x:r.left, y:r.top, w:r.width, h:r.height}; })()`;

export const ad_format = "(document.querySelector('.ad') || {dataset:{}}).dataset.format";

export const layout_facts = `(() => {
    const s = document.querySelector('.stage, .ad'); const r = s ? s.getBoundingClientRect() : null;
    const over = document.documentElement.scrollWidth > window.innerWidth + 2;
    const blank = [...document.querySelectorAll('canvas')].filter(c => c.getBoundingClientRect().width < 4 || c.getBoundingClientRect().height < 4).length;
    return { stage: r ? [Math.round(r.width), Math.round(r.height)] : null, horizontal_overflow: over, zero_size_canvases: blank, fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) };
  })()`;

export const horizontal_overflow = "({ horizontal_overflow: document.documentElement.scrollWidth > window.innerWidth + 2 })";

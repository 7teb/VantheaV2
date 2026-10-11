# Wireframe 3D

Look: black stage, thin cyan to violet lines, depth fade (far lines dim), small bright vertex dots, a perspective floor grid, a faint glow. Technical and clean.
Stage: `<canvas class="fill" id="w_canvas">` in `.stage.h_lg`. No libraries, you project the points yourself.

## Technique
1. A mesh is `{ v: [[x,y,z],...], e: [[i,j],...] }`.
2. Rotate each vertex around Y then X, then divide by depth for perspective.
3. Draw edges with alpha based on depth (far = faint). Draw vertices as dots.
4. Drag to rotate. Keep the velocity and let it coast (inertia) with decay 0.95.
5. Idle slow auto rotation so it is never static.
6. Floor: a grid of lines at `y = 1.7` projected the same way, alpha fading toward the outer lines (`1 - abs(i) / 7`), strong enough to read over the glow (about .4 at the center).

## Code
```js
const canvas = $('#w_canvas'), c = fit_canvas(canvas), ptr = pointer_in(canvas);
const CAM = 4.6;

function cube() {
  const v = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  const e = []; for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { const d = i ^ j; if (d === 1 || d === 2 || d === 4) e.push([i, j]); }
  return { v, e };
}
function icosa() {
  const t = (1 + Math.sqrt(5)) / 2, v = [];
  for (const a of [-1, 1]) for (const b of [-t, t]) { v.push([0, a, b], [a, b, 0], [b, 0, a]); }
  const e = []; for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
    const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]); if (Math.abs(d - 2) < .01) e.push([i, j]);
  }
  return { v: v.map((p) => p.map((n) => n * .75)), e };
}
function torus(R = 1.1, r = .5, a = 28, b = 14) {
  const v = [], e = [];
  for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) {
    const u = i / a * TAU, w = j / b * TAU;
    v.push([(R + r * Math.cos(w)) * Math.cos(u), r * Math.sin(w), (R + r * Math.cos(w)) * Math.sin(u)]);
    e.push([i * b + j, i * b + (j + 1) % b], [i * b + j, ((i + 1) % a) * b + j]);
  }
  return { v, e };
}
function sphere(R = 1.4, lat = 10, lon = 20) {
  const v = [], e = [];
  for (let i = 1; i < lat; i++) for (let j = 0; j < lon; j++) {
    const p = i / lat * Math.PI, q = j / lon * TAU;
    v.push([R * Math.sin(p) * Math.cos(q), R * Math.cos(p), R * Math.sin(p) * Math.sin(q)]);
    const k = (i - 1) * lon + j; e.push([k, (i - 1) * lon + (j + 1) % lon]); if (i > 1) e.push([k, k - lon]);
  }
  return { v, e };
}
const meshes = { cube: cube(), icosa: icosa(), torus: torus(), sphere: sphere() };
let mesh = meshes.torus, grow = 0, rx = -.45, ry = .6, vx = 0, vy = .006, lx = 0, ly = 0;

function project(p, out, ay = ry, ax = rx) {   // ay, ax default to the live rotation, the floor passes fixed angles
  const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
  const x1 = p[0] * cy + p[2] * sy, z1 = -p[0] * sy + p[2] * cy;
  const y1 = p[1] * cx - z1 * sx, z2 = p[1] * sx + z1 * cx;
  const k = Math.min(c.w, c.h) * 1.15 / (CAM + z2);
  out.x = c.w / 2 + x1 * k; out.y = c.h * .46 + y1 * k; out.z = z2; return out;
}
const pa = {}, pb = {};
animate_when_visible(canvas, (t, dt) => {
  if (ptr.down) { vy = (ptr.x - lx) * .008; vx = (ptr.y - ly) * .008; } else { vy = damp(vy, .006, 1.2, dt); vx = damp(vx, 0, 2, dt); }
  lx = ptr.x; ly = ptr.y; ry += vy; rx = clamp(rx + vx, -1.4, 1.4);
  grow = damp(grow, 1, 4, dt);
  const ctx = c.ctx; ctx.clearRect(0, 0, c.w, c.h); ctx.fillStyle = '#030303'; ctx.fillRect(0, 0, c.w, c.h);
  // floor grid
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) for (const axis of [0, 1]) {
    const a = axis ? [i * .5, 1.7, -3] : [-3, 1.7, i * .5], b = axis ? [i * .5, 1.7, 3] : [3, 1.7, i * .5];
    project(a, pa, 0, -.45); project(b, pb, 0, -.45);          // fixed angles, the floor never spins
    ctx.strokeStyle = `rgba(122,92,255,${.42 * (1 - Math.abs(i) / 7)})`; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  // mesh
  ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.2;
  const sc = grow;
  for (const [i, j] of mesh.e) {
    const A = mesh.v[i], B = mesh.v[j];
    project([A[0] * sc, A[1] * sc, A[2] * sc], pa); project([B[0] * sc, B[1] * sc, B[2] * sc], pb);
    const depth = clamp(((pa.z + pb.z) / 2 + 2) / 4, 0, 1);     // 0 far, 1 near
    ctx.strokeStyle = `hsla(${190 + (1 - depth) * 90},95%,${55 + depth * 20}%,${.15 + depth * .75})`;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
});
```
Changing mesh: `mesh = meshes[name]; grow = 0;` so it scales in smoothly.
Optional: hidden line fade (dim edges whose midpoint z is far), vertex dots `arc(x, y, 1 + depth * 1.6)`.

## Controls
`seg` Cube / Icosa / Torus / Sphere, slider Speed (scales the idle `.006`), toggle Dots.

## Pitfalls
- Everything at the same brightness looks flat. Depth fade is the whole effect.
- Do not rotate the floor with the mesh.
- A sphere with fewer than 8 latitudes looks like a box.
- Forgetting to clamp `rx` flips the object upside down.

## Done when
A solid looking rotating mesh with clear front and back lines, dragging rotates it with coasting, shape changes scale in, the floor grid stays put.

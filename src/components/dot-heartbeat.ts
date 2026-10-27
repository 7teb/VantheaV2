export const heartbeat_period_ms = 6300;

export type HeartbeatFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type Spread = { spin: number; pitch: number; yaw: number };
type Vec = [number, number, number];
type Pose = { x: number; y: number; depth: number; pulse: number };

const degree = Math.PI / 180;
const steps = 315;
const radius = 4.8;
const drift = 0.46;
const gather = 0.15;
const beat = 0.2;
const burst = 0.19;
const cycle = drift + gather + beat + burst;
const drift_spin = 16 * degree;
const breathe = 0.3;
const lub = 0.46;
const dub = 0.26;
const pop = 1.5;
const depth_scale = 0.38;
const rest_opacity = 0.86;
const depth_fade = 0.46;
const min_opacity = 0.36;

const spreads: Spread[] = [
  { spin: -90, pitch: 18, yaw: 0 },
  { spin: 90, pitch: -14, yaw: 30 },
  { spin: -30, pitch: 28, yaw: -26 },
];

const point = (spread: Spread, dot: number, extra: number, scale: number): Vec => {
  const angle = (spread.spin + dot * 120) * degree + extra;
  const x0 = radius * scale * Math.cos(angle);
  const y0 = radius * scale * Math.sin(angle);
  const pitch = spread.pitch * degree;
  const yaw = spread.yaw * degree;
  const y1 = y0 * Math.cos(pitch);
  const z1 = y0 * Math.sin(pitch);
  return [x0 * Math.cos(yaw) + z1 * Math.sin(yaw), y1, z1 * Math.cos(yaw) - x0 * Math.sin(yaw)];
};

const back_out = (p: number): number => {
  const q = p - 1;
  return 1 + (pop + 1) * q ** 3 + pop * q ** 2;
};

const bump = (p: number, from: number, to: number): number => (p <= from || p >= to ? 0 : Math.sin((Math.PI * (p - from)) / (to - from)) ** 2);

const pose_at = (t: number): Pose[] => {
  const u = t * spreads.length * cycle;
  const index = Math.min(spreads.length - 1, Math.floor(u / cycle));
  const local = u - index * cycle;
  const here = spreads[index];
  const next = spreads[(index + 1) % spreads.length];
  return [0, 1, 2].map((dot) => {
    let at: Vec;
    let pulse = 1;
    if (local < drift) {
      const p = local / drift;
      at = point(here, dot, drift_spin * p, 1 + breathe * Math.sin(2 * Math.PI * p) / radius);
    } else if (local < drift + gather) {
      const p = (local - drift) / gather;
      const from = point(here, dot, drift_spin, 1);
      const k = 1 - p ** 3;
      at = [from[0] * k, from[1] * k, from[2] * k];
    } else if (local < drift + gather + beat) {
      const p = (local - drift - gather) / beat;
      at = [0, 0, 0];
      pulse = 1 + lub * bump(p, 0, 0.42) + dub * bump(p, 0.5, 0.88);
    } else {
      const p = (local - drift - gather - beat) / burst;
      const to = point(next, dot, 0, 1);
      const k = back_out(p);
      at = [to[0] * k, to[1] * k, to[2] * k];
    }
    return { x: at[0], y: at[1], depth: at[2] / radius, pulse };
  });
};

const frames = Array.from({ length: steps + 1 }, (_, step): HeartbeatFrame[] => {
  const t = step / steps;
  const poses = pose_at(t);
  const order = [...poses.keys()].sort((a, b) => poses[a].depth - poses[b].depth || a - b);
  return poses.map((pose, dot) => ({
    offset: t,
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${((1 + depth_scale * pose.depth) * pose.pulse).toFixed(3)})`,
    opacity: Number(Math.min(1, Math.max(min_opacity, rest_opacity + depth_fade * pose.depth)).toFixed(3)),
    zIndex: order.indexOf(dot) + 1,
  }));
});

export const heartbeat_keyframes: HeartbeatFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

export const weave_period_ms = 6400;

export type WeaveFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type WeavePose = { depth: number; transform: string; opacity: number };

const steps = 192;
const laps = 4;
const radius = 6;
const lift = 3;
const surge = 0.07;
const gather = 0.84;
const depth_scale = 0.36;
const back_opacity = 0.5;
const tail_shrink = 0.38;
const tail_fade = 0.4;
const degree = Math.PI / 180;
const reach = Math.hypot(radius, lift);

const swing_at = (t: number): number => 30 * Math.sin(2 * Math.PI * t) * degree;
const tilt_at = (t: number): number => (16 + 10 * Math.sin(4 * Math.PI * t + 0.6)) * degree;
const bunch_at = (t: number): number => Math.sin(Math.PI * t) ** 4;

const weave_pose = (dot: number, t: number): WeavePose => {
  const slot = dot - 1;
  const lap = laps * t;
  const bunch = bunch_at(t);
  const spacing = ((2 * Math.PI) / 3) * (1 - gather * bunch);
  const angle = slot * spacing + 2 * Math.PI * (lap + surge * Math.sin(2 * Math.PI * lap));
  const swing = swing_at(t);
  const tilt = tilt_at(t);
  const ring_x = radius * Math.sin(angle);
  const ring_y = lift * Math.sin(2 * angle);
  const ring_z = radius * Math.cos(angle);
  const x = ring_x * Math.cos(swing) + ring_z * Math.sin(swing);
  const z = ring_z * Math.cos(swing) - ring_x * Math.sin(swing);
  const y = ring_y * Math.cos(tilt) + z * Math.sin(tilt);
  const depth = (z * Math.cos(tilt) - ring_y * Math.sin(tilt)) / reach;
  const trail = (bunch * (1 - slot)) / 2;
  const scale = (1 + depth_scale * depth) * (1 - tail_shrink * trail);
  const opacity = (back_opacity + ((1 - back_opacity) * (depth + 1)) / 2) * (1 - tail_fade * trail);
  return {
    depth,
    transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(3)})`,
    opacity: Number(opacity.toFixed(3)),
  };
};

const frames = Array.from({ length: steps + 1 }, (_, step): WeaveFrame[] => {
  const t = step / steps;
  const poses = [0, 1, 2].map((dot) => weave_pose(dot, t));
  const order = [0, 1, 2].sort((a, b) => poses[a].depth - poses[b].depth || a - b);
  return poses.map((pose, dot) => ({ offset: t, transform: pose.transform, opacity: pose.opacity, zIndex: order.indexOf(dot) + 1 }));
});

export const weave_keyframes: WeaveFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

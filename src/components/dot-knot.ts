export const knot_period_ms = 6400;

export type KnotFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type Pose = { x: number; y: number; depth: number };

const degree = Math.PI / 180;
const steps = 320;
const loops = 3;
const spacing = 0.9;
const size = 1.5;
const lean = 24 * degree;
const spin = 1;
const reach = 3.2 * size;
const depth_scale = 0.34;
const rest_opacity = 0.86;
const depth_fade = 0.46;
const min_opacity = 0.36;

const trefoil = (u: number): [number, number, number] => [
  size * (Math.sin(u) + 2 * Math.sin(2 * u)),
  size * (Math.cos(u) - 2 * Math.cos(2 * u)),
  size * -Math.sin(3 * u),
];

const pose_at = (t: number): Pose[] => {
  const head = 2 * Math.PI * loops * t;
  const yaw = 2 * Math.PI * spin * t;
  const pitch = lean * Math.sin(2 * Math.PI * t);
  return [0, 1, 2].map((dot) => {
    const [x0, y0, z0] = trefoil(head - dot * spacing);
    const x1 = x0 * Math.cos(yaw) + z0 * Math.sin(yaw);
    const z1 = z0 * Math.cos(yaw) - x0 * Math.sin(yaw);
    const y = y0 * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z = y0 * Math.sin(pitch) + z1 * Math.cos(pitch);
    return { x: x1, y, depth: z / reach };
  });
};

const frames = Array.from({ length: steps + 1 }, (_, step): KnotFrame[] => {
  const t = step / steps;
  const poses = pose_at(t);
  const order = [...poses.keys()].sort((a, b) => poses[a].depth - poses[b].depth || b - a);
  return poses.map((pose, dot) => ({
    offset: t,
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${(1 + depth_scale * pose.depth).toFixed(3)})`,
    opacity: Number(Math.min(1, Math.max(min_opacity, rest_opacity + depth_fade * pose.depth)).toFixed(3)),
    zIndex: order.indexOf(dot) + 1,
  }));
});

export const knot_keyframes: KnotFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

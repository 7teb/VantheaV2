export const juggle_period_ms = 5400;

export type JuggleFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type Hold = { kind: "hold"; from: number; to: number; x0: number; x1: number; dip: number; swing: number };
type Flight = { kind: "flight"; from: number; to: number; x0: number; x1: number; side: number };
type Segment = Hold | Flight;
type Spot = { x: number; y: number; z: number };
type Pose = { x: number; y: number; depth: number };

const degree = Math.PI / 180;
const steps = 292;
const throws = 12;
const flight = 1.7;
const dwell = 1.3;
const lead = 0.6;
const end = 14;
const inner = 1.4;
const outer = 5;
const rest_right = 3.4;
const hand_y = 2.8;
const peak_y = -4.8;
const scoop = 0.9;
const wind_up = 0.7;
const follow = 0.7;
const pass = 2.2;
const turn = 20 * degree;
const view = 14 * degree;
const reach = 5;
const depth_scale = 0.36;
const rest_opacity = 0.86;
const depth_fade = 0.46;
const min_opacity = 0.36;

const throw_order = [1, 2, 0];
const rest_x = [-outer, -inner, rest_right];

const hand_x = (hand: number, spot: number): number => (hand === 0 ? -spot : spot);

const schedule = (): Segment[][] => {
  const segments: Segment[][] = [[], [], []];
  const state = rest_x.map((x) => ({ x, since: -lead, caught: false }));
  for (let beat = 0; beat < throws; beat += 1) {
    const dot = throw_order[beat % 3];
    const hand = beat % 2;
    const ball = state[dot];
    const from_x = hand_x(hand, inner);
    const to_x = hand_x(1 - hand, outer);
    const dip = ball.caught ? scoop : wind_up;
    segments[dot].push({ kind: "hold", from: ball.since, to: beat, x0: ball.x, x1: from_x, dip, swing: ball.caught ? follow : 0 });
    segments[dot].push({ kind: "flight", from: beat, to: beat + flight, x0: from_x, x1: to_x, side: hand === 0 ? 1 : -1 });
    state[dot] = { x: to_x, since: beat + flight, caught: true };
  }
  state.forEach((ball, dot) => {
    const settled = ball.since + dwell;
    segments[dot].push({ kind: "hold", from: ball.since, to: settled, x0: ball.x, x1: rest_x[dot], dip: scoop, swing: follow });
    segments[dot].push({ kind: "hold", from: settled, to: end, x0: rest_x[dot], x1: rest_x[dot], dip: 0, swing: 0 });
  });
  return segments;
};

const timeline = schedule();

const smooth = (p: number): number => (1 - Math.cos(Math.PI * p)) / 2;

const spot_at = (segment: Segment, beat: number): Spot => {
  const span = segment.to - segment.from;
  const u = span > 0 ? Math.min(1, Math.max(0, (beat - segment.from) / span)) : 1;
  if (segment.kind === "flight") {
    return {
      x: segment.x0 + (segment.x1 - segment.x0) * u,
      y: hand_y + (peak_y - hand_y) * 4 * u * (1 - u),
      z: segment.side * pass * Math.sin(Math.PI * u),
    };
  }
  const outward = Math.sign(segment.x0) * segment.swing * Math.sin(Math.PI * u) * (1 - u);
  return {
    x: segment.x0 + (segment.x1 - segment.x0) * smooth(u) + outward,
    y: hand_y + segment.dip * Math.sin(Math.PI * u),
    z: 0,
  };
};

const pose_at = (t: number): Pose[] => {
  const beat = -lead + t * (lead + end);
  const yaw = turn * Math.sin(2 * Math.PI * t);
  return timeline.map((segments) => {
    const segment = segments.find((entry) => beat <= entry.to) ?? segments[segments.length - 1];
    const spot = spot_at(segment, beat);
    const x = spot.x * Math.cos(yaw) + spot.z * Math.sin(yaw);
    const z = spot.z * Math.cos(yaw) - spot.x * Math.sin(yaw);
    return {
      x,
      y: spot.y * Math.cos(view) + z * Math.sin(view),
      depth: (z * Math.cos(view) - (spot.y - hand_y) * Math.sin(view)) / reach,
    };
  });
};

const frames = Array.from({ length: steps + 1 }, (_, step): JuggleFrame[] => {
  const t = step / steps;
  const poses = pose_at(t);
  const order = [...poses.keys()].sort((a, b) => poses[a].depth - poses[b].depth || a - b);
  return poses.map((pose, dot) => ({
    offset: t,
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${(1 + depth_scale * pose.depth).toFixed(3)})`,
    opacity: Number(Math.min(1, Math.max(min_opacity, rest_opacity + depth_fade * pose.depth)).toFixed(3)),
    zIndex: order.indexOf(dot) + 1,
  }));
});

export const juggle_keyframes: JuggleFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

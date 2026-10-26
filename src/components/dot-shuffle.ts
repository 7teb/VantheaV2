export const shuffle_period_ms = 5400;

export type ShuffleFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type Swap = { from: number; to: number; move: number; hold: number; lean: number };

type Pose = { x: number; y: number; depth: number; shrink: number };

const degree = Math.PI / 180;
const steps = 270;
const gap = 5;
const reach = 4.2;
const view = 18 * degree;
const yaw = 24 * degree;
const bob = 0.45;
const wind = 1.4;
const make_way = 0.8;
const duck = 0.2;
const depth_scale = 0.4;
const rest_opacity = 0.86;
const depth_fade = 0.46;
const min_opacity = 0.36;

const swaps: Swap[] = [
  { from: 0, to: 1, move: 0.55, hold: 0.12, lean: 28 },
  { from: 1, to: 2, move: 0.55, hold: 0.42, lean: -28 },
  { from: 0, to: 2, move: 0.85, hold: 0.58, lean: 38 },
  { from: 0, to: 1, move: 0.55, hold: 0.12, lean: -28 },
  { from: 1, to: 2, move: 0.55, hold: 0.42, lean: 28 },
  { from: 0, to: 2, move: 0.85, hold: 0.58, lean: -38 },
];

const total = swaps.reduce((sum, swap) => sum + swap.move + swap.hold, 0);

const timeline = (() => {
  const seats = [0, 1, 2];
  let start = 0;
  return swaps.map((swap) => {
    const entry = { ...swap, start, seats: [...seats] };
    start += swap.move + swap.hold;
    [seats[swap.from], seats[swap.to]] = [seats[swap.to], seats[swap.from]];
    return entry;
  });
})();

const smooth = (p: number): number => (1 - Math.cos(Math.PI * p)) / 2;

const springy = (p: number): number => {
  const c = wind * 1.525;
  return p < 0.5 ? ((2 * p) ** 2 * ((c + 1) * 2 * p - c)) / 2 : ((2 * p - 2) ** 2 * ((c + 1) * (2 * p - 2) + c) + 2) / 2;
};

const pose_at = (t: number): Pose[] => {
  const u = t * total;
  const swap = timeline.reduce((found, entry) => (entry.start <= u ? entry : found), timeline[0]);
  const p = Math.min(1, (u - swap.start) / swap.move);
  const glide = springy(p);
  const arc = Math.sin(Math.PI * smooth(p));
  const lean = swap.lean * degree;
  const half = (Math.abs(swap.to - swap.from) * gap) / 2;
  const far = Math.abs(swap.to - swap.from) === 2;
  const turn = yaw * Math.sin(2 * Math.PI * t + 0.4);
  const float = bob * Math.sin(4 * Math.PI * t);
  const poses: Pose[] = [];
  swap.seats.forEach((dot, seat) => {
    let lx = (seat - 1) * gap;
    let ly = 0;
    let lz = 0;
    let shrink = 1;
    if (seat === swap.from || seat === swap.to) {
      const target = seat === swap.from ? swap.to : swap.from;
      const side = seat === swap.from ? 1 : -1;
      lx += (target - seat) * gap * glide;
      lz = side * half * arc * Math.cos(lean);
      ly = side * half * arc * Math.sin(lean);
    } else if (far) {
      shrink = 1 - duck * arc;
    } else {
      ly = -make_way * arc;
    }
    const x = lx * Math.cos(turn) + lz * Math.sin(turn);
    const z = lz * Math.cos(turn) - lx * Math.sin(turn);
    const y = ly + float;
    poses[dot] = {
      x,
      y: y * Math.cos(view) + z * Math.sin(view),
      depth: (z * Math.cos(view) - y * Math.sin(view)) / reach,
      shrink,
    };
  });
  return poses;
};

const frames = Array.from({ length: steps + 1 }, (_, step): ShuffleFrame[] => {
  const t = step / steps;
  const poses = pose_at(t);
  const order = [...poses.keys()].sort((a, b) => poses[a].depth - poses[b].depth || a - b);
  return poses.map((pose, dot) => ({
    offset: t,
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${((1 + depth_scale * pose.depth) * pose.shrink).toFixed(3)})`,
    opacity: Number(Math.min(1, Math.max(min_opacity, rest_opacity + depth_fade * pose.depth)).toFixed(3)),
    zIndex: order.indexOf(dot) + 1,
  }));
});

export const shuffle_keyframes: ShuffleFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

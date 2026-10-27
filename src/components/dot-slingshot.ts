export const slingshot_period_ms = 6600;

export type SlingshotFrame = { offset: number; transform: string; opacity: number; zIndex: number };

type Slot = "a" | "b" | "o";
type Swap = { at: number; span: number; inner: "a" | "b" };
type Pose = { x: number; y: number; depth: number };

const degree = Math.PI / 180;
const steps = 330;
const tight = 1.7;
const wide = 6;
const pair_turns = 6.5;
const ring_turns = 1;
const tilt = 32 * degree;
const wobble = 10 * degree;
const lift = 1.4;
const depth_scale = 0.36;
const rest_opacity = 0.86;
const depth_fade = 0.46;
const min_opacity = 0.36;

const swaps: Swap[] = [
  { at: 0.17, span: 0.16, inner: "b" },
  { at: 0.5, span: 0.16, inner: "a" },
  { at: 0.83, span: 0.16, inner: "b" },
];

const timeline = (() => {
  let seats: Record<Slot, number> = { a: 0, b: 1, o: 2 };
  return swaps.map((swap) => {
    const entry = { ...swap, start: swap.at - swap.span / 2, end: swap.at + swap.span / 2, seats: { ...seats } };
    seats = { ...seats, [swap.inner]: seats.o, o: seats[swap.inner] };
    return entry;
  });
})();

const smooth = (p: number): number => (1 - Math.cos(Math.PI * p)) / 2;

const slot_angle = (slot: Slot, t: number): number => {
  if (slot === "o") {
    return 2 * Math.PI * ring_turns * t + Math.PI / 2;
  }
  return 2 * Math.PI * pair_turns * t + (slot === "b" ? Math.PI : 0);
};

const slot_radius = (slot: Slot): number => (slot === "o" ? wide : tight);

const seat_of = (seats: Record<Slot, number>, dot: number): Slot => (["a", "b", "o"] as Slot[]).find((slot) => seats[slot] === dot) ?? "o";

const unwrap = (target: number, from: number): number => target + 2 * Math.PI * Math.ceil((from - target) / (2 * Math.PI));

const polar_at = (dot: number, t: number) => {
  const active = timeline.find((swap) => t >= swap.start && t <= swap.end);
  const settled = [...timeline].reverse().find((swap) => t > swap.end);
  const seats = settled ? { ...settled.seats, [settled.inner]: settled.seats.o, o: settled.seats[settled.inner] } : { a: 0, b: 1, o: 2 };
  if (active) {
    const coming = active.seats.o === dot;
    const going = active.seats[active.inner] === dot;
    if (coming || going) {
      const from: Slot = coming ? "o" : active.inner;
      const to: Slot = coming ? active.inner : "o";
      const anchor = coming ? active.start : active.end;
      const offset = unwrap(slot_angle(to, anchor), slot_angle(from, anchor)) - slot_angle(to, anchor);
      const w = smooth((t - active.start) / active.span);
      const angle = slot_angle(from, t) + (slot_angle(to, t) + offset - slot_angle(from, t)) * w;
      const radius = slot_radius(from) + (slot_radius(to) - slot_radius(from)) * w;
      return { angle, radius, normal: (coming ? 1 : -1) * lift * Math.sin(Math.PI * w) };
    }
  }
  const slot = seat_of(active ? active.seats : seats, dot);
  return { angle: slot_angle(slot, t), radius: slot_radius(slot), normal: 0 };
};

const pose_at = (t: number): Pose[] => {
  const elevation = tilt + wobble * Math.sin(2 * Math.PI * t);
  return [0, 1, 2].map((dot) => {
    const { angle, radius, normal } = polar_at(dot, t);
    const along = radius * Math.sin(angle);
    const x = radius * Math.cos(angle);
    const y = -along * Math.sin(elevation) + normal * Math.cos(elevation);
    const z = -along * Math.cos(elevation) - normal * Math.sin(elevation);
    return { x, y, depth: z / wide };
  });
};

const frames = Array.from({ length: steps + 1 }, (_, step): SlingshotFrame[] => {
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

export const slingshot_keyframes: SlingshotFrame[][] = [0, 1, 2].map((dot) => frames.map((frame) => frame[dot]));

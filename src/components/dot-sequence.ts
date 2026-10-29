import { heartbeat_keyframes, heartbeat_period_ms, type HeartbeatFrame } from "./dot-heartbeat.ts";
import { juggle_keyframes, juggle_period_ms, type JuggleFrame } from "./dot-juggle.ts";
import { knot_keyframes, knot_period_ms, type KnotFrame } from "./dot-knot.ts";
import { orbit_keyframes, orbit_period_ms, type OrbitFrame } from "./dot-orbit.ts";
import { shuffle_keyframes, shuffle_period_ms, type ShuffleFrame } from "./dot-shuffle.ts";
import { slingshot_keyframes, slingshot_period_ms, type SlingshotFrame } from "./dot-slingshot.ts";
import { weave_keyframes, weave_period_ms, type WeaveFrame } from "./dot-weave.ts";

export type DotFrame = OrbitFrame | WeaveFrame | ShuffleFrame | JuggleFrame | SlingshotFrame | HeartbeatFrame | KnotFrame;

export type DotMotion = { frames: DotFrame[][]; duration: number };

export type DotKeyframe = DotFrame & { easing?: string };

export const bridge_ms = 800;

export const emerge_ms = 400;

const center = { transform: "translate(0.00px, 0.00px) scale(1.000)", opacity: 1 };

const settle = "cubic-bezier(0.4, 0, 0.2, 1)";

export const dot_motions: DotMotion[] = [
  { frames: orbit_keyframes, duration: orbit_period_ms },
  { frames: weave_keyframes, duration: weave_period_ms },
  { frames: shuffle_keyframes, duration: shuffle_period_ms },
  { frames: juggle_keyframes, duration: juggle_period_ms },
  { frames: slingshot_keyframes, duration: slingshot_period_ms },
  { frames: heartbeat_keyframes, duration: heartbeat_period_ms },
  { frames: knot_keyframes, duration: knot_period_ms },
];

export const first_motion = (random: () => number = Math.random): number => Math.floor(random() * dot_motions.length);

export const next_motion = (index: number, random: () => number = Math.random): number =>
  (index + 1 + Math.floor(random() * (dot_motions.length - 1))) % dot_motions.length;

export const bridge_frames = (from: DotMotion, to: DotMotion, dot: number): DotKeyframe[] => {
  const last = from.frames[dot].at(-1) ?? from.frames[dot][0];
  const first = to.frames[dot][0];
  return [
    { ...last, offset: 0, easing: settle },
    { ...center, zIndex: last.zIndex, offset: 0.42 },
    { ...center, zIndex: first.zIndex, offset: 0.58, easing: settle },
    { ...first, offset: 1 },
  ];
};

export const emerge_frames = (to: DotMotion, dot: number): DotKeyframe[] => {
  const first = to.frames[dot][0];
  return [
    { ...center, zIndex: first.zIndex, offset: 0, easing: settle },
    { ...first, offset: 1 },
  ];
};

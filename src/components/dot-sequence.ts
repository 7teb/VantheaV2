import { orbit_keyframes, orbit_period_ms, type OrbitFrame } from "./dot-orbit.ts";
import { shuffle_keyframes, shuffle_period_ms, type ShuffleFrame } from "./dot-shuffle.ts";
import { weave_keyframes, weave_period_ms, type WeaveFrame } from "./dot-weave.ts";

export type DotFrame = OrbitFrame | WeaveFrame | ShuffleFrame;

export type DotMotion = { frames: DotFrame[][]; duration: number };

export const bridge_ms = 400;

export const dot_motions: DotMotion[] = [
  { frames: orbit_keyframes, duration: orbit_period_ms },
  { frames: weave_keyframes, duration: weave_period_ms },
  { frames: shuffle_keyframes, duration: shuffle_period_ms },
];

export const next_motion = (index: number): number => (index + 1) % dot_motions.length;

export const bridge_frames = (from: DotMotion, to: DotMotion, dot: number): DotFrame[] => {
  const last = from.frames[dot].at(-1) ?? from.frames[dot][0];
  return [
    { ...last, offset: 0 },
    { ...to.frames[dot][0], offset: 1 },
  ];
};

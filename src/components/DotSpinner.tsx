import { useLayoutEffect, useRef } from "react";
import { bridge_frames, bridge_ms, dot_motions, emerge_frames, emerge_ms, first_motion, next_motion } from "./dot-sequence.ts";
import "./DotSpinner.css";

const reduced_motion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DotSpinner = () => {
  const root = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) {
      return;
    }
    const dots = [...node.children];
    let running: Animation[] = [];
    let stopped = false;

    const run = (frames: (dot: number) => Keyframe[], options: KeyframeAnimationOptions, then: (() => void) | null) => {
      const previous = running;
      running = dots.map((dot, index) => dot.animate(frames(index), { ...options, fill: "forwards" }));
      previous.forEach((animation) => animation.cancel());
      const first = running[0];
      if (then && first) {
        first.onfinish = () => {
          if (!stopped) {
            then();
          }
        };
      }
    };

    const play = (index: number) => {
      const motion = dot_motions[index];
      const following = next_motion(index);
      const next = dot_motions[following];
      run(
        (dot) => motion.frames[dot],
        { duration: motion.duration },
        () => run((dot) => bridge_frames(motion, next, dot), { duration: bridge_ms }, () => play(following)),
      );
    };

    const emerge = (index: number) => run((dot) => emerge_frames(dot_motions[index], dot), { duration: emerge_ms }, () => play(index));

    if (reduced_motion()) {
      run((dot) => dot_motions[0].frames[dot], { duration: dot_motions[0].duration }, null);
      running.forEach((animation) => animation.pause());
    } else {
      emerge(first_motion());
    }
    return () => {
      stopped = true;
      running.forEach((animation) => animation.cancel());
    };
  }, []);

  return (
    <span ref={root} className="dot-spinner" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
};

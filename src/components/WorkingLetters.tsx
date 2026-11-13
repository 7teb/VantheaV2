import { memo, useLayoutEffect, useRef } from "react";
import { wave_frames, wave_timing } from "./letter-wave.ts";
import { reduced_motion } from "./reduced-motion.ts";
import "./WorkingLetters.css";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const LetterWave = ({ text }: { text: string }) => {
  const root = useRef<HTMLSpanElement>(null);
  const letters = Array.from(graphemes.segment(text), ({ segment }) => segment);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node || reduced_motion()) {
      return;
    }
    const spans = [...node.children];
    const running = spans.map((span, index) => span.animate(wave_frames(spans.length), wave_timing(spans.length, index)));
    return () => running.forEach((animation) => animation.cancel());
  }, [text]);

  return (
    <span ref={root} className="working-wave">
      {letters.map((segment, index) => (
        <span key={index} className="working-letter">
          {segment}
        </span>
      ))}
    </span>
  );
};

type WorkingLettersProps = { text: string; active?: boolean };

export const WorkingLetters = memo(({ text, active = true }: WorkingLettersProps) => (active ? <LetterWave text={text} /> : <>{text}</>));

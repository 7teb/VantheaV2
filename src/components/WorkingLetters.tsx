import { memo, type CSSProperties } from "react";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

type WorkingLettersProps = { text: string; active?: boolean };

export const WorkingLetters = memo(({ text, active = true }: WorkingLettersProps) =>
  active ? (
    <>
      {Array.from(graphemes.segment(text), ({ segment }, index) => (
        <span key={index} className="working-letter" style={{ "--letter": index } as CSSProperties}>
          {segment}
        </span>
      ))}
    </>
  ) : (
    <>{text}</>
  ),
);

import { strip_ansi } from "./process.ts";

export type OutputCollector = {
  append: (chunk: string) => void;
  text: () => string;
  tail: (chars: number) => string;
  lines: () => number;
};

const clean = (text: string) => strip_ansi(text.replace(/[^\n]*\r(?!\n)/g, ""));

export const output_collector = (head_limit: number, tail_limit: number): OutputCollector => {
  let head = "";
  let tail = "";
  let total = 0;
  let newlines = 0;
  return {
    append: (chunk) => {
      total += chunk.length;
      newlines += chunk.split("\n").length - 1;
      const room = Math.max(0, head_limit - head.length);
      head += chunk.slice(0, room);
      const rest = chunk.slice(room);
      if (rest) {
        tail = (tail + rest).slice(-tail_limit);
      }
    },
    text: () => {
      const omitted = total - head.length - tail.length;
      return omitted > 0 ? `${clean(head)}\n[... ${omitted} characters of output omitted ...]\n${clean(tail)}` : clean(head + tail);
    },
    tail: (chars) => clean((head + tail).slice(-chars)),
    lines: () => newlines,
  };
};

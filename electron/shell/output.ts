import { estimate_tokens, result_cap_tokens } from "../context/estimate.ts";
import { strip_ansi } from "./process.ts";

export type OutputPieces = { head: string; tail: string; chars: number };

export type OutputView = {
  text: (max_tokens: number) => string;
  tail: (chars: number) => string;
  chars: () => number;
  lines: () => number;
};

export type OutputCollector = OutputView & {
  append: (chunk: string) => void;
  pieces: () => OutputPieces;
};

const window_chars = result_cap_tokens * 4;

const head_limit = window_chars / 4;

const tail_limit = window_chars - head_limit;

const open_escape = /\x1B(?:\[[0-9;?]*|[()]|\][^\x07\x1B]*\x1B?)?$/;

const settle_line = (line: string, last: boolean): string => {
  const ending = !last && line.endsWith("\r") ? "\r" : "";
  const body = ending ? line.slice(0, -1) : line;
  return body.slice(body.lastIndexOf("\r") + 1) + ending;
};

const settle_lines = (text: string): string => text.split("\n").map((line, index, lines) => settle_line(line, index === lines.length - 1)).join("\n");

const unsettled = (line: string): string => (line.length > 1 ? line.slice(line.lastIndexOf("\r", line.length - 2) + 1) : line);

const placed = (kept: OutputPieces, text: string): OutputPieces => {
  const room = Math.max(0, head_limit - kept.head.length);
  const rest = text.slice(room);
  return { head: kept.head + text.slice(0, room), tail: rest ? (kept.tail + rest).slice(-tail_limit) : kept.tail, chars: kept.chars + text.length };
};

const omitted_marker = (chars: number): string =>
  `[output over the ${result_cap_tokens}-token cap per tool result: ${chars} characters omitted here. Redirect the output to a file and read that file, or filter the output, to see them.]`;

const is_high_surrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

const is_low_surrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

const longest_fit = (length: number, fits: (size: number) => boolean): number => {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
};

const fitting_prefix = (text: string, max_tokens: number): string => {
  const size = longest_fit(text.length, (count) => estimate_tokens(text.slice(0, count)) <= max_tokens);
  return text.slice(0, size > 0 && is_high_surrogate(text.charCodeAt(size - 1)) ? size - 1 : size);
};

const fitting_suffix = (text: string, max_tokens: number): string => {
  const size = longest_fit(text.length, (count) => estimate_tokens(text.slice(text.length - count)) <= max_tokens);
  const start = text.length - size;
  return text.slice(size > 0 && is_low_surrogate(text.charCodeAt(start)) ? start + 1 : start);
};

const fit_pieces = (head: string, tail: string, gap: number, total: number, max_tokens: number): string => {
  const available = Math.max(0, max_tokens - estimate_tokens(`\n${omitted_marker(total)}\n`));
  const head_share = Math.floor(available / 4);
  const kept_tail = fitting_suffix(tail, available - Math.min(head_share, estimate_tokens(head)));
  const kept_head = fitting_prefix(head, available - estimate_tokens(kept_tail));
  const omitted = gap > 0 ? gap + head.length - kept_head.length + tail.length - kept_tail.length : head.length - kept_head.length - kept_tail.length;
  return `${kept_head}\n${omitted_marker(omitted)}\n${kept_tail}`;
};

export const output_collector = (from: OutputPieces = { head: "", tail: "", chars: 0 }): OutputCollector => {
  let kept: OutputPieces = { head: from.head.slice(0, head_limit), tail: from.tail.slice(-tail_limit), chars: Math.max(from.chars, from.head.length + from.tail.length) };
  let newlines = (kept.head + kept.tail).split("\n").length - 1;
  let held = "";
  let line = "";
  const view = (): OutputPieces => placed(kept, settle_line(line, true));
  return {
    append: (chunk) => {
      newlines += chunk.split("\n").length - 1;
      const raw = held + chunk;
      const open = raw.match(open_escape);
      held = open && open[0].length <= 4096 ? open[0] : "";
      const text = line + strip_ansi(raw.slice(0, raw.length - held.length));
      const end = text.lastIndexOf("\n");
      if (end >= 0) {
        kept = placed(kept, settle_lines(text.slice(0, end + 1)));
      }
      line = unsettled(text.slice(end + 1));
      if (line.length > tail_limit) {
        kept = placed(kept, line);
        line = "";
      }
    },
    text: (max_tokens) => {
      const { head, tail, chars } = view();
      const gap = chars - head.length - tail.length;
      if (gap > 0) {
        return fit_pieces(head, tail, gap, chars, max_tokens);
      }
      const whole = head + tail;
      return estimate_tokens(whole) <= max_tokens ? whole : fit_pieces(whole, whole, 0, chars, max_tokens);
    },
    tail: (chars) => {
      const shown = view();
      return (shown.chars > shown.head.length + shown.tail.length ? shown.tail : shown.head + shown.tail).slice(-chars);
    },
    chars: () => view().chars,
    lines: () => newlines,
    pieces: view,
  };
};

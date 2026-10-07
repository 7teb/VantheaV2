export type TextWindow = { start_line: number; end_line: number; total_lines: number; content: string; truncated: boolean };

export const max_window_tokens = 25000;

const max_line_chars = 100000;

const token_estimate = (text: string): number => {
  const non_ascii = Buffer.byteLength(text, "utf8") - text.length;
  return Math.ceil(text.length / 4 + non_ascii / 2);
};

export const text_window = (text: string, start_line: number, limit: number | null): TextWindow => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const total_lines = lines.length;
  const start = Math.min(Math.max(1, start_line), total_lines);
  const last = limit === null ? total_lines : Math.min(total_lines, start + Math.max(1, limit) - 1);
  const selected: string[] = [];
  let tokens = 0;
  let truncated = false;
  for (let number = start; number <= last; number += 1) {
    const line = lines[number - 1] ?? "";
    const rendered = `${number}: ${line.length > max_line_chars ? `${line.slice(0, max_line_chars)} ...[line truncated]` : line}`;
    const cost = token_estimate(rendered) + 1;
    if (selected.length && tokens + cost > max_window_tokens) {
      truncated = true;
      break;
    }
    selected.push(rendered);
    tokens += cost;
  }
  return { start_line: start, end_line: start + selected.length - 1, total_lines, content: selected.join("\n"), truncated };
};

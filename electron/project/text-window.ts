import { looks_binary, text_stream } from "../storage/text-codec.ts";

export type TextWindow = {
  start_line: number;
  end_line: number;
  total_lines: number;
  content: string;
  truncated: boolean;
  binary: boolean;
};

export const max_line_chars = 4000;

export const estimate_tokens = (text: string): number => {
  const non_ascii = Buffer.byteLength(text, "utf8") - text.length;
  return Math.ceil(text.length / 4 + non_ascii / 2);
};

export const read_text_window = async (file: string, start_line: number, limit: number, max_tokens: number): Promise<TextWindow> => {
  const start = Math.max(1, Math.floor(start_line));
  const count = Math.max(1, Math.floor(limit));
  const selected: string[] = [];
  let used_tokens = 0;
  let line_number = 0;
  let pending = "";
  let cut = false;
  let truncated = false;
  let first_chunk = true;

  const consume = () => {
    line_number += 1;
    if (!truncated && line_number >= start && line_number < start + count) {
      const rendered = `${line_number}: ${pending}${cut ? ` ... [line cut at ${max_line_chars} characters]` : ""}`;
      const tokens = estimate_tokens(rendered) + 1;
      if (used_tokens + tokens > max_tokens) {
        truncated = true;
      } else {
        selected.push(rendered);
        used_tokens += tokens;
      }
    }
    pending = "";
    cut = false;
  };

  const { stream } = await text_stream(file);
  for await (const chunk of stream as AsyncIterable<string>) {
    if (first_chunk && looks_binary(chunk)) {
      stream.destroy();
      return { start_line: start, end_line: start - 1, total_lines: 0, content: "", truncated: false, binary: true };
    }
    first_chunk = false;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf("\n", offset);
      const end = newline < 0 ? chunk.length : newline;
      const room = max_line_chars - pending.length;
      if (!cut) {
        pending += chunk.slice(offset, Math.min(end, offset + room));
        cut = end - offset > room;
      }
      if (newline < 0) {
        break;
      }
      if (!cut && pending.endsWith("\r")) {
        pending = pending.slice(0, -1);
      }
      consume();
      offset = newline + 1;
    }
  }
  if (pending.length || cut) {
    if (!cut && pending.endsWith("\r")) {
      pending = pending.slice(0, -1);
    }
    consume();
  }
  return {
    start_line: start,
    end_line: start + selected.length - 1,
    total_lines: line_number,
    content: selected.join("\n"),
    truncated,
    binary: false,
  };
};

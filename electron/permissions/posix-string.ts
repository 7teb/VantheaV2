import { backtick_end, paren_end } from "./posix-lex.ts";
import type { Piece } from "./shell-words.ts";

export const posix_string = (source: string, start: number, end: number): Piece[] => {
  const pieces: Piece[] = [];
  let text = "";
  let index = start + 1;
  const stop = source[end - 1] === '"' ? end - 1 : end;
  const flush = () => { if (text) pieces.push({ kind: "text", quote: "double", text }); text = ""; };
  while (index < stop) {
    const char = source[index];
    if (char === "\\" && /[\\$"`\n]/.test(source[index + 1] ?? "")) {
      text += source[index + 1] === "\n" ? "" : source[index + 1];
      index += 2;
      continue;
    }
    if (char === "`" || (char === "$" && source[index + 1] === "(")) {
      flush();
      const next = char === "`" ? backtick_end(source, index) : paren_end(source, index + 1);
      const body = index + (char === "`" ? 1 : 2);
      pieces.push({ kind: "group", open: "$(", text: source.slice(body, Math.max(body, next - 1)), start: body });
      index = next;
      continue;
    }
    text += char;
    index += 1;
  }
  flush();
  return pieces.length ? pieces : [{ kind: "text", quote: "double", text: "" }];
};

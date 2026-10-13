import type { SourceLanguage } from "./script-constants.ts";

const blank = (value: string): string => value.replace(/[^\r\n]/g, " ");

const regex_before = /[(,=:[!&|?{};+\-*%<>~^]$|(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

const js_literal = /"(?:\\.|[^"\\\r\n])*"?|'(?:\\.|[^'\\\r\n])*'?|\x60(?:\\.|[^\x60\\])*\x60?|\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|^#![^\r\n]*/y;

const comment_start = /^(?:\/[/*]|#)/;

const regex_end = (text: string, start: number): number => {
  let in_class = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === "\r" || char === "\n") return -1;
    else if (char === "[") in_class = true;
    else if (char === "]") in_class = false;
    else if (char === "/" && !in_class) return index + 1 + (/^[a-z]*/.exec(text.slice(index + 1))?.[0].length ?? 0);
  }
  return -1;
};

const js_mask = (text: string, strings: boolean): string => {
  let out = "";
  let index = 0;
  let before = "";
  while (index < text.length) {
    js_literal.lastIndex = index;
    const found = js_literal.exec(text)?.[0];
    const operator = before.trimEnd();
    const regex = !found && text[index] === "/" && (!operator || regex_before.test(operator)) ? regex_end(text, index) : -1;
    const end = found ? index + found.length : regex;
    if (end > index) {
      const piece = text.slice(index, end);
      out += strings || (found !== undefined && comment_start.test(piece)) ? blank(piece) : piece;
      if (!found?.startsWith("/") && !found?.startsWith("#")) before = (before + "x").slice(-16);
      index = end;
      continue;
    }
    out += text[index];
    before = (before + text[index]).slice(-16);
    index += 1;
  }
  return out;
};

export const code_mask = (text: string, language: SourceLanguage | null = null, strings = true): string =>
  language === "js"
    ? js_mask(text, strings)
    : text.replace(/(?:(?<![\w$])[rRuUbBfF]{1,2}(?=["']))?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\x60(?:\\.|[^\x60\\])*\x60|\/{2}[^\r\n]*|\/\*[\s\S]*?\*\/|#[^\r\n]*/g, (piece) => (strings || comment_start.test(piece) ? blank(piece) : piece));

export const top_level = (text: string, separator: string, language: SourceLanguage | null = null): string[] => {
  const masked = code_mask(text, language);
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(last, index));
      last = index + 1;
    }
  }
  return [...parts, text.slice(last)];
};

export const call_arguments = (text: string, start: number, opening = "(", closing = ")"): string => {
  let depth = 1;
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index);
    }
  }
  return text.slice(start);
};

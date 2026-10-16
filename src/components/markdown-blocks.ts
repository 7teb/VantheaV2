const fence_pattern = /^ {0,3}(`{3,}|~{3,})/;

const math_fence_pattern = /^ {0,3}\$\$\s*$/;

const opens_fence = (line: string): string | null => {
  const code = fence_pattern.exec(line);
  if (code) {
    return code[1];
  }
  return math_fence_pattern.test(line) ? "$$" : null;
};

const closes_fence = (line: string, fence: string): boolean => {
  if (fence === "$$") {
    return math_fence_pattern.test(line);
  }
  const trimmed = line.trim();
  return trimmed.length >= fence.length && trimmed === fence[0].repeat(trimmed.length);
};

const without_trailing_blank = (lines: string[]): string => {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end).join("\n");
};

const definition_pattern = /^ {0,3}\[\^?[^\]\n]+\]:/;

export const split_blocks = (text: string): string[] => {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let gap = false;
  let defines = false;
  for (const line of text.split("\n")) {
    if (fence !== null) {
      current.push(line);
      if (closes_fence(line, fence)) {
        fence = null;
      }
      continue;
    }
    if (line.trim() === "") {
      if (current.length > 0) {
        gap = true;
        current.push(line);
      }
      continue;
    }
    if (gap && !/^[ \t]/.test(line)) {
      blocks.push(without_trailing_blank(current));
      current = [];
    }
    gap = false;
    current.push(line);
    fence = opens_fence(line);
    defines ||= definition_pattern.test(line);
  }
  if (current.length > 0) {
    blocks.push(without_trailing_blank(current));
  }
  return defines && blocks.length > 1 ? [blocks.join("\n\n")] : blocks;
};

const code_span_pattern = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

const single_dollar = (text: string, at: number) => text[at] === "$" && text[at - 1] !== "$" && text[at + 1] !== "$" && text[at - 1] !== "\\";

const opens_math = (text: string, at: number) => single_dollar(text, at) && /\S/.test(text[at + 1] ?? "");

const closes_math = (text: string, at: number) => single_dollar(text, at) && /\S/.test(text[at - 1] ?? "") && !/\d/.test(text[at + 1] ?? "");

const math_close = (text: string, open: number): number => {
  for (let at = open + 2; at < text.length && text[at] !== "\n"; at += 1) {
    if (closes_math(text, at)) {
      return at;
    }
  }
  return -1;
};

export const escape_currency = (text: string): string => {
  let out = "";
  let from = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (!single_dollar(text, at)) {
      continue;
    }
    const close = opens_math(text, at) ? math_close(text, at) : -1;
    if (close >= 0) {
      at = close;
      continue;
    }
    out += `${text.slice(from, at)}\\$`;
    from = at + 1;
  }
  return out + text.slice(from);
};

export const normalize_math = (text: string): string =>
  text
    .split(code_span_pattern)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : escape_currency(
            part
              .replace(/\\\[([\s\S]+?)\\\]/g, (...groups: string[]) => `$$${groups[1]}$$`)
              .replace(/\\\(([\s\S]+?)\\\)/g, (...groups: string[]) => `$${groups[1]?.trim()}$`),
          ),
    )
    .join("");

const math_pattern = /\$\$|\$[^$\n]+\$/;

export const has_math = (text: string): boolean => text.split(code_span_pattern).some((part, index) => index % 2 === 0 && math_pattern.test(part));

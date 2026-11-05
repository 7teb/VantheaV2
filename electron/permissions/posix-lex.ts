export const single_end = (source: string, start: number): number => {
  const close = source.indexOf("'", start + 1);
  return close < 0 ? source.length : close + 1;
};

export const dollar_single_end = (source: string, start: number): number => {
  let index = start + 2;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "'") {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
};

export const double_end = (source: string, start: number): number => {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      index = backtick_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "(") {
      index = paren_end(source, index + 1);
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
};

export function backtick_end(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

export function parameter_end(source: string, start: number): number {
  let index = start + 2;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "'") {
      index = single_end(source, index);
      continue;
    }
    if (char === '"') {
      index = double_end(source, index);
      continue;
    }
    if (char === "`") {
      index = backtick_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "'") {
      index = dollar_single_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "(") {
      index = paren_end(source, index + 1);
      continue;
    }
    if (char === "}") return index + 1;
    index += 1;
  }
  return source.length;
}

export const word_end = (source: string, start: number): number => {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
    } else if (char === "'") {
      index = single_end(source, index);
    } else if (char === '"') {
      index = double_end(source, index);
    } else if (char === "`") {
      index = backtick_end(source, index);
    } else if (char === "$" && source[index + 1] === "'") {
      index = dollar_single_end(source, index);
    } else if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
    } else if ((char === "$" || char === "<" || char === ">") && source[index + 1] === "(") {
      index = paren_end(source, index + 1);
    } else if (/[\s;|&()<>]/.test(char ?? "")) {
      break;
    } else {
      index += 1;
    }
  }
  return Math.min(index, source.length);
};

export function paren_end(source: string, start: number): number {
  let depth = 0;
  let index = start;
  let begin = start + 1;
  const cases: boolean[] = [];
  while (index < source.length) {
    if (cases.at(-1)) {
      const pattern = case_pattern(source, index);
      if (pattern.closed) {
        cases.pop();
      } else {
        cases[cases.length - 1] = false;
      }
      index = begin = pattern.end;
      continue;
    }
    const char = source[index] ?? "";
    if (char === "'") {
      index = single_end(source, index);
      continue;
    }
    if (char === '"') {
      index = double_end(source, index);
      continue;
    }
    if (char === "`") {
      index = backtick_end(source, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
      continue;
    }
    const header = char === "c" ? case_head(source, index, begin) : -1;
    if (header >= 0) {
      cases.push(true);
      index = begin = header;
      continue;
    }
    const closed = cases.length && char === "e" ? case_keyword(source, index, "esac") : -1;
    if (closed >= 0 && !source.slice(begin, index).replace(/\\\r?\n/g, "").trim()) {
      cases.pop();
      index = begin = closed;
      continue;
    }
    const ending = cases.length && char === ";" ? /^(?:;;&|;;|;&)/.exec(source.slice(index))?.[0] : "";
    if (ending) {
      cases[cases.length - 1] = true;
      index = begin = index + ending.length;
      continue;
    }
    if (/[;|&\r\n]/.test(char)) {
      begin = index + 1;
    }
    if (char === "(") {
      depth += 1;
      begin = index + 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
}

export const brace_end = (source: string, start: number): number => {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "'") {
      index = single_end(source, index);
      continue;
    }
    if (char === '"') {
      index = double_end(source, index);
      continue;
    }
    if (char === "`") {
      index = backtick_end(source, index);
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
};

export const body_end = (source: string, from: number, tag: string, dashed: boolean): { body: string; next: number } => {
  const lines: string[] = [];
  let index = from;
  while (index <= source.length) {
    let stop = source.indexOf("\n", index);
    if (stop < 0) stop = source.length;
    const line = source.slice(index, stop).replace(/\r$/, "");
    const trimmed = dashed ? line.replace(/^\t+/, "") : line;
    if (trimmed === tag) {
      return { body: lines.join("\n"), next: stop < source.length ? stop + 1 : source.length };
    }
    lines.push(line);
    if (stop >= source.length) break;
    index = stop + 1;
  }
  return { body: lines.join("\n"), next: source.length };
};

export const feeds_shell = /(?:^|[\s;&|(])(?:[^\s;&|]*\/)?(?:bash|sh|dash|eval)(?=\s|$)/i;

export const token_boundary = (char: string | undefined): boolean => char === undefined || /[\s;|&()]/.test(char);

export type CaseGroup = { branches: { start: number; end: number }[]; expansions: string[]; expressions: { text: string; start: number }[] };

export type CaseFrame = { group: CaseGroup; pattern: boolean; body: number; root: CaseGroup };

const skip_blank = (source: string, start: number): number => {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index] ?? "")) {
      index += 1;
    } else if (/^\\\r?\n/.test(source.slice(index))) {
      index += source[index + 1] === "\r" ? 3 : 2;
    } else if (source[index] === "#") {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
    } else {
      break;
    }
  }
  return index;
};

export const case_keyword = (source: string, start: number, name: string): number => {
  const end = word_end(source, start);
  return source.slice(start, end).replace(/\\\r?\n/g, "") === name ? end : -1;
};

export const case_head = (source: string, start: number, begin: number): number => {
  const keyword = case_keyword(source, start, "case");
  if (keyword < 0 || !/^(?:(?:if|then|else|elif|do|while|until|!|time)\s+)*$/.test(source.slice(begin, start).replace(/\\\r?\n/g, "").trimStart())) return -1;
  const word = skip_blank(source, keyword);
  const end = word_end(source, word);
  if (end === word) return -1;
  const next = skip_blank(source, end);
  return case_keyword(source, next, "in");
};

export const case_pattern = (source: string, start: number): { end: number; closed: boolean; expansions: { text: string; start: number }[] } => {
  let index = skip_blank(source, start);
  const expansions: { text: string; start: number }[] = [];
  const closed = case_keyword(source, index, "esac");
  if (closed >= 0) return { end: closed, closed: true, expansions };
  if (source[index] === "(") {
    index += 1;
  }
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "'") {
      index = single_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "'") {
      index = dollar_single_end(source, index);
      continue;
    }
    if (char === '"') {
      const end = double_end(source, index);
      expansions.push({ text: source.slice(index, end), start: index });
      index = end;
      continue;
    }
    if (char === "`" || (char === "$" && source[index + 1] === "(")) {
      const end = char === "`" ? backtick_end(source, index) : paren_end(source, index + 1);
      expansions.push({ text: source.slice(index, end), start: index });
      index = end;
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      const end = parameter_end(source, index);
      expansions.push({ text: source.slice(index, end), start: index });
      index = end;
      continue;
    }
    if (char === "(") {
      index = paren_end(source, index);
      continue;
    }
    if (char === ")") return { end: index + 1, closed: false, expansions };
    index += 1;
  }
  return { end: source.length, closed: false, expansions };
};

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

export function paren_end(source: string, start: number): number {
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
    if (char === "(") {
      depth += 1;
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

export const heredoc = /^<<(-?)\s*(?:(['"])([A-Za-z_]\w*)\2|\\?([A-Za-z_]\w*))/;

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

export const token_boundary = (char: string | undefined): boolean => char === undefined || /[\s;|&(){}]/.test(char);

const closers: Record<string, string> = { "(": ")", "{": "}", "[": "]" };

const here_open = /[ \t]*\r?\n/y;

const single_quotes = "'\u2018\u2019\u201a\u201b";

const double_quotes = '"\u201c\u201d\u201e';

export const quote_of = (char: string | undefined): "'" | '"' | "" => {
  if (!char) return "";
  if (single_quotes.includes(char)) return "'";
  return double_quotes.includes(char) ? '"' : "";
};

export const here_string_end = (source: string, at: number): number => {
  const quote = quote_of(source[at + 1]);
  if (source[at] !== "@" || !quote || /[\w$`]/.test(source[at - 1] ?? "")) return -1;
  here_open.lastIndex = at + 2;
  if (!here_open.test(source)) return -1;
  for (let close = source.indexOf("\n", at + 2); close >= 0; close = source.indexOf("\n", close + 1)) {
    if (quote_of(source[close + 1]) === quote && source[close + 2] === "@") return close + 3;
  }
  return source.length;
};

export const skip_quoted = (source: string, start: number): number => {
  const quote = quote_of(source[start]);
  const here = source[start - 1] === "@" ? here_string_end(source, start - 1) : -1;
  if (here >= 0) return here;
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (quote === '"' && char === "`") {
      index += 2;
      continue;
    }
    if (quote_of(char) === quote) {
      if (quote_of(source[index + 1]) === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    if (quote === '"' && char === "$" && source[index + 1] === "(") {
      index = skip_group(source, index + 1);
      continue;
    }
    index += 1;
  }
  return source.length;
};

const token_before = (source: string, index: number): boolean =>
  /[\s;|&(){}]/.test(source[index - 1] ?? " ") && !(source[index - 1] === "{" && source[index - 2] === "$");

export const comment_end = (source: string, index: number): number => {
  const block = source[index] === "<";
  const end = block ? source.indexOf("#>", index + 2) : source.indexOf("\n", index);
  if (end < 0) return source.length;
  return block ? end + 2 : end;
};

export const skip_group = (source: string, start: number): number => {
  const close = closers[source[start] ?? ""];
  let depth = 0;
  let index = start;
  let string_end = false;
  while (index < source.length) {
    const char = source[index] ?? "";
    const token_start: boolean = string_end || token_before(source, index);
    string_end = false;
    if (quote_of(char)) {
      index = skip_quoted(source, index);
      string_end = token_start;
      continue;
    }
    if (char === "`") {
      index += 2;
      continue;
    }
    if (token_start && (char === "#" || (char === "<" && source[index + 1] === "#"))) {
      index = comment_end(source, index);
      continue;
    }
    if (char === source[start]) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
};

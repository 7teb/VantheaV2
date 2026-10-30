export class LiteralError extends Error {
  readonly at: number;

  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

export type Parsed = { value: unknown; end: number };

export const line_column = (text: string, at: number): string => {
  const before = text.slice(0, at);
  const line = before.split("\n").length;
  const column = at - before.lastIndexOf("\n");
  return `line ${line}, column ${column}`;
};

const identifier_start = /[A-Za-z_$]/;

const identifier_part = /[A-Za-z0-9_$]/;

export const skip_space = (text: string, from: number): number => {
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text[at] ?? "")) {
      at += 1;
    }
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) {
        throw new LiteralError("a /* comment is never closed", at);
      }
      at = end + 2;
      continue;
    }
    return at;
  }
};

const read_identifier = (text: string, from: number): string => {
  let at = from;
  while (at < text.length && identifier_part.test(text[at] ?? "")) {
    at += 1;
  }
  return text.slice(from, at);
};

const simple_escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };

const read_escape = (text: string, at: number): { char: string; end: number } => {
  const next = text[at] ?? "";
  if (next in simple_escapes && !(next === "0" && /[0-9]/.test(text[at + 1] ?? ""))) {
    return { char: simple_escapes[next] ?? "", end: at + 1 };
  }
  if (next === "x") {
    const hex = text.slice(at + 1, at + 3);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
      throw new LiteralError("a \\x escape needs two hex digits", at - 1);
    }
    return { char: String.fromCharCode(parseInt(hex, 16)), end: at + 3 };
  }
  if (next === "u") {
    if (text[at + 1] === "{") {
      const close = text.indexOf("}", at + 2);
      const hex = close < 0 ? "" : text.slice(at + 2, close);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) {
        throw new LiteralError("a \\u{...} escape needs 1 to 6 hex digits up to 10FFFF", at - 1);
      }
      return { char: String.fromCodePoint(parseInt(hex, 16)), end: close + 1 };
    }
    const hex = text.slice(at + 1, at + 5);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new LiteralError("a \\u escape needs four hex digits", at - 1);
    }
    return { char: String.fromCharCode(parseInt(hex, 16)), end: at + 5 };
  }
  if (next === "\r" && text[at + 1] === "\n") {
    return { char: "", end: at + 2 };
  }
  if (next === "\n" || next === "\r" || next === " " || next === " ") {
    return { char: "", end: at + 1 };
  }
  if (/[1-9]/.test(next)) {
    throw new LiteralError("octal escapes are not allowed", at - 1);
  }
  return { char: next, end: at + 1 };
};

const read_string = (text: string, from: number): Parsed => {
  const quote = text[from] ?? "";
  let at = from + 1;
  let value = "";
  while (at < text.length) {
    const char = text[at] ?? "";
    if (char === quote) {
      return { value, end: at + 1 };
    }
    if (char === "\\") {
      const escape = read_escape(text, at + 1);
      value += escape.char;
      at = escape.end;
      continue;
    }
    if (quote === "`" && char === "$" && text[at + 1] === "{") {
      throw new LiteralError("template interpolation ${...} is not allowed in meta, write the text out", at);
    }
    if (quote !== "`" && (char === "\n" || char === "\r")) {
      throw new LiteralError("a string is never closed on its line", from);
    }
    value += char;
    at += 1;
  }
  throw new LiteralError("a string is never closed", from);
};

const number_pattern = /^-?(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[oO][0-7](?:_?[0-7])*|0[bB][01](?:_?[01])*|(?:(?:0|[1-9](?:_?[0-9])*)(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?)/;

const read_number = (text: string, from: number): Parsed => {
  const match = number_pattern.exec(text.slice(from));
  if (!match || match[0] === "-") {
    throw new LiteralError("expected a number", from);
  }
  const raw = match[0];
  const end = from + raw.length;
  if (identifier_part.test(text[end] ?? "")) {
    throw new LiteralError(`the number ${raw} runs into other characters`, from);
  }
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).replaceAll("_", "");
  const prefixed = /^0[xXoObB]/.test(digits);
  const value = prefixed ? Number(digits) : Number.parseFloat(digits);
  if (!Number.isFinite(value)) {
    throw new LiteralError(`the number ${raw} is not finite`, from);
  }
  return { value: negative ? -value : value, end };
};

const read_key = (text: string, at: number): { key: string; end: number } => {
  const char = text[at] ?? "";
  if (char === "'" || char === '"') {
    const parsed = read_string(text, at);
    return { key: String(parsed.value), end: parsed.end };
  }
  if (char === "`") {
    throw new LiteralError("a template string cannot be an object key", at);
  }
  if (char === "[") {
    throw new LiteralError("computed keys are not allowed in meta", at);
  }
  if (text.startsWith("...", at)) {
    throw new LiteralError("spreads are not allowed in meta", at);
  }
  if (/[0-9]/.test(char)) {
    const parsed = read_number(text, at);
    return { key: String(parsed.value), end: parsed.end };
  }
  if (!identifier_start.test(char)) {
    throw new LiteralError(`expected a property name, found ${char ? `"${char}"` : "the end of the script"}`, at);
  }
  const key = read_identifier(text, at);
  return { key, end: at + key.length };
};

const read_object = (text: string, from: number): Parsed => {
  const value: Record<string, unknown> = {};
  let at = skip_space(text, from + 1);
  while (text[at] !== "}") {
    const { key, end } = read_key(text, at);
    if (Object.hasOwn(value, key)) {
      throw new LiteralError(`the key ${key} appears twice`, at);
    }
    at = skip_space(text, end);
    if (text[at] !== ":") {
      throw new LiteralError(text[at] === "(" ? "methods are not allowed in meta" : `the key ${key} needs a ":" and a literal value`, at);
    }
    const parsed = parse_literal(text, skip_space(text, at + 1));
    Object.defineProperty(value, key, { value: parsed.value, enumerable: true, writable: true, configurable: true });
    at = skip_space(text, parsed.end);
    if (text[at] === ",") {
      at = skip_space(text, at + 1);
      continue;
    }
    if (text[at] !== "}") {
      throw new LiteralError('expected "," or "}" in an object', at);
    }
  }
  return { value, end: at + 1 };
};

const read_array = (text: string, from: number): Parsed => {
  const value: unknown[] = [];
  let at = skip_space(text, from + 1);
  while (text[at] !== "]") {
    if (text[at] === ",") {
      throw new LiteralError("array holes are not allowed in meta", at);
    }
    if (text.startsWith("...", at)) {
      throw new LiteralError("spreads are not allowed in meta", at);
    }
    const parsed = parse_literal(text, at);
    value.push(parsed.value);
    at = skip_space(text, parsed.end);
    if (text[at] === ",") {
      at = skip_space(text, at + 1);
      continue;
    }
    if (text[at] !== "]") {
      throw new LiteralError('expected "," or "]" in an array', at);
    }
  }
  return { value, end: at + 1 };
};

const keywords: Record<string, unknown> = { true: true, false: false, null: null };

export const parse_literal = (text: string, from: number): Parsed => {
  const at = skip_space(text, from);
  const char = text[at] ?? "";
  if (char === "{") {
    return read_object(text, at);
  }
  if (char === "[") {
    return read_array(text, at);
  }
  if (char === "'" || char === '"' || char === "`") {
    return read_string(text, at);
  }
  if (char === "-" || char === "." || /[0-9]/.test(char)) {
    return read_number(text, at);
  }
  if (text.startsWith("...", at)) {
    throw new LiteralError("spreads are not allowed in meta", at);
  }
  if (identifier_start.test(char)) {
    const word = read_identifier(text, at);
    if (Object.hasOwn(keywords, word)) {
      return { value: keywords[word], end: at + word.length };
    }
    const after = skip_space(text, at + word.length);
    const what = text[after] === "(" ? `the call ${word}(...)` : `the identifier ${word}`;
    throw new LiteralError(`meta must be a pure literal, found ${what}; write the value out as a literal`, at);
  }
  throw new LiteralError(char ? `unexpected "${char}" where a literal value belongs` : "the script ends where a literal value belongs", at);
};

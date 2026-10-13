import { here_string_end, quote_of, skip_group, skip_quoted, type Dialect } from "./statements.ts";

type Quote = "none" | "single" | "double" | "single_here" | "double_here" | "verbatim";

export type Piece =
  | { kind: "text"; quote: Quote; text: string }
  | { kind: "group"; open: "(" | "$(" | "@(" | "@{"; text: string; start: number }
  | { kind: "block"; text: string; start: number }
  | { kind: "splat"; name: string };

export type Word = { raw: string; start: number; glued: boolean; op: string; pieces: Piece[] };

type WordMode = "argument" | "expression";

const blank = /[ \t\r\n\f\v ]/;

const redirect = /[1-6*]?>>?(?:&[12])?|<(?!#)/y;

const plain_redirect = /[1-6*]?>>?(?:&[12])?|</y;

const dashes = /^[\u2013\u2014\u2015]/;

const glued_parameter = /[-\u2013\u2014\u2015][A-Za-z_?][\w-]*:(?=[^\s:])/y;

const dot_operand = /["'$@{\u2018-\u201e]/;

const name_char = /[\w?]/;

type Scan = { end: number; pieces: Piece[] };

const string_pieces = (content: string, offset: number, quote: Quote): Piece[] => {
  const pieces: Piece[] = [];
  let text = "";
  let index = 0;
  while (index < content.length) {
    const char = content[index] ?? "";
    if (char === "`") {
      text += content.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (quote_of(char) === '"' && quote === "double" && quote_of(content[index + 1]) === '"') {
      text += '"';
      index += 2;
      continue;
    }
    if (char === "$" && content[index + 1] === "(") {
      const end = skip_group(content, index + 1);
      if (text) pieces.push({ kind: "text", quote, text });
      text = "";
      pieces.push({ kind: "group", open: "$(", text: content.slice(index + 2, Math.max(index + 2, end - 1)), start: offset + index + 2 });
      index = end;
      continue;
    }
    text += char;
    index += 1;
  }
  if (text || !pieces.length) pieces.push({ kind: "text", quote, text });
  return pieces;
};

const quoted = (source: string, index: number): Scan => {
  const here = source[index] === "@";
  const at = here ? index + 1 : index;
  const quote = quote_of(source[at]) || "'";
  const end = skip_quoted(source, at);
  if (here) {
    const body = source.indexOf("\n", at) + 1;
    const closed = end >= 3 && source[end - 1] === "@" && quote_of(source[end - 2]) === quote && source[end - 3] === "\n";
    const content = (closed ? source.slice(body, end - 3) : source.slice(body)).replace(/\r$/, "");
    return { end, pieces: quote === "'" ? [{ kind: "text", quote: "single_here", text: content }] : string_pieces(content, body, "double_here") };
  }
  const closed = end > at + 1 && quote_of(source[end - 1]) === quote;
  const content = source.slice(at + 1, closed ? end - 1 : end);
  return { end, pieces: quote === "'" ? [{ kind: "text", quote: "single", text: content.replace(/(['\u2018\u2019\u201a\u201b])['\u2018\u2019\u201a\u201b]/g, "$1") }] : string_pieces(content, at + 1, "double") };
};

const grouped = (source: string, index: number): Scan => {
  const two = source.slice(index, index + 2);
  const open = two === "$(" || two === "@(" || two === "@{" ? two : (source[index] ?? "(");
  const at = index + open.length - 1;
  const end = skip_group(source, at);
  const closed = end > at + 1 && source[end - 1] === (source[at] === "{" ? "}" : ")");
  const text = source.slice(at + 1, closed ? end - 1 : end);
  if (open === "{") return { end, pieces: [{ kind: "block", text, start: at + 1 }] };
  return { end, pieces: [{ kind: "group", open: open as "(" | "$(" | "@(" | "@{", text, start: at + 1 }] };
};

const variable_end = (source: string, index: number): number => {
  if (source[index + 1] === "{") {
    const close = source.indexOf("}", index + 2);
    return close < 0 ? source.length : close + 1;
  }
  let end = index + 1;
  while (end < source.length && (name_char.test(source[end] ?? "") || (source[end] === ":" && name_char.test(source[end + 1] ?? "")))) end += 1;
  return end;
};

const member_end = (source: string, index: number): number => {
  let end = index;
  while (end < source.length) {
    const char = source[end] ?? "";
    if (char === "[" || char === "(") {
      end = skip_group(source, end);
      continue;
    }
    if (char !== "." && char !== ":" && !/\w/.test(char)) break;
    end += 1;
  }
  return end;
};

const closed_start = (char: string, next: string) => quote_of(char) !== "" || char === "(" || char === "{" || (char === "@" && (next === "(" || next === "{"));

const powershell_word = (source: string, start: number, mode: WordMode): Scan => {
  const pieces: Piece[] = [];
  let text = "";
  let index = start;
  const flush = () => {
    if (text) pieces.push({ kind: "text", quote: "none", text });
    text = "";
  };
  const add = (scan: Scan) => {
    flush();
    pieces.push(...scan.pieces);
    index = scan.end;
  };
  const char = source[start] ?? "";
  const next = source[start + 1] ?? "";
  const here = char === "@" && here_string_end(source, start) >= 0;
  if (here || closed_start(char, next)) {
    add(here || quote_of(char) ? quoted(source, start) : grouped(source, start));
    if (source[index] === "." || source[index] === "[") {
      text = source.slice(index, member_end(source, index));
      index += text.length;
      flush();
    }
    return { end: index, pieces };
  }
  if (mode === "argument" && char === "@" && /[A-Za-z_?]/.test(next)) {
    const end = variable_end(source, start);
    return { end, pieces: [{ kind: "splat", name: source.slice(start + 1, end) }] };
  }
  if (mode === "expression" && char === "$" && next !== "(") {
    const end = variable_end(source, start);
    const tail = source[end] === "." || source[end] === "[" ? member_end(source, end) : end;
    return { end: tail, pieces: [{ kind: "text", quote: "none", text: source.slice(start, tail) }] };
  }
  if (char === "[") {
    const end = skip_group(source, start);
    text = source.slice(start, end);
    index = end;
  }
  while (index < source.length) {
    const current = source[index] ?? "";
    const following = source[index + 1] ?? "";
    if (blank.test(current) || current === "," || current === "(" || current === "{" || current === ">" || current === "<") break;
    if (current === ")" || current === "}") break;
    if (mode === "expression" && (current === "+" || quote_of(current) || current === "$")) break;
    if (current === "`") {
      if (following === "\n" || following === "\r") break;
      text += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (current === "$" && following === "(") {
      add(grouped(source, index));
      continue;
    }
    if (current === "$" && following === "{") {
      const end = variable_end(source, index);
      text += source.slice(index, end);
      index = end;
      continue;
    }
    if (current === "@" && (following === "(" || following === "{")) break;
    if (quote_of(current)) {
      add(quoted(source, index));
      continue;
    }
    text += current;
    index += 1;
  }
  flush();
  return { end: Math.max(index, start + 1), pieces: pieces.length ? pieces : [{ kind: "text", quote: "none", text: source[start] ?? "" }] };
};

const powershell_words = (source: string, mode: WordMode): Word[] => {
  const words: Word[] = [];
  let index = 0;
  let glued = false;
  let verbatim = false;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === "`" && /[\r\n]/.test(source[index + 1] ?? "")) {
      index += 2;
      glued = false;
      continue;
    }
    if (blank.test(char)) {
      index += 1;
      glued = false;
      continue;
    }
    if (char === "#" || (char === "<" && source[index + 1] === "#")) {
      const close = char === "#" ? source.indexOf("\n", index) : source.indexOf("#>", index + 2);
      index = close < 0 ? source.length : char === "#" ? close : close + 2;
      continue;
    }
    const start = index;
    if (verbatim) {
      while (index < source.length && !blank.test(source[index] ?? "")) index += 1;
      words.push({ raw: source.slice(start, index), start, glued, op: "", pieces: [{ kind: "text", quote: "verbatim", text: source.slice(start, index) }] });
      glued = true;
      continue;
    }
    redirect.lastIndex = index;
    const redirected = redirect.exec(source)?.[0] ?? "";
    const op = char === "," || (mode === "expression" && char === "+") ? char : redirected ? (redirected.includes("<") ? "<" : ">") : "";
    if (op) {
      index += op === "," || op === "+" ? 1 : redirected.length;
      words.push({ raw: source.slice(start, index), start, glued, op, pieces: [] });
      glued = false;
      continue;
    }
    const next = source[index + 1] ?? " ";
    if (char === "&" || (char === "." && (blank.test(next) || (mode === "argument" && !words.length && dot_operand.test(next))))) {
      index += 1;
      words.push({ raw: char, start, glued, op: "", pieces: [{ kind: "text", quote: "none", text: char }] });
      glued = true;
      continue;
    }
    glued_parameter.lastIndex = index;
    const parameter = mode === "argument" ? glued_parameter.exec(source)?.[0] : undefined;
    if (parameter) {
      const text = "-" + parameter.slice(1);
      words.push({ raw: text, start, glued, op: "", pieces: [{ kind: "text", quote: "none", text }] });
      index += parameter.length;
      glued = true;
      continue;
    }
    const scan = powershell_word(source, index, mode);
    index = scan.end;
    const first = scan.pieces[0];
    const dashed = mode === "argument" && dashes.test(source[start] ?? "") && first?.kind === "text" && first.quote === "none";
    const raw = dashed ? "-" + source.slice(start + 1, index) : source.slice(start, index);
    const pieces = dashed && first?.kind === "text" ? [{ ...first, text: "-" + first.text.slice(1) }, ...scan.pieces.slice(1)] : scan.pieces;
    words.push({ raw, start, glued, op: "", pieces });
    verbatim = mode === "argument" && raw === "--%";
    glued = true;
  }
  return words;
};

const cmd_group_end = (source: string, start: number): number => {
  let depth = 0;
  let inside = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') inside = !inside;
    else if (inside) continue;
    else if (char === "^") index += 1;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index + 1;
  }
  return source.length;
};

const plain_words = (source: string, dialect: "cmd" | "posix"): Word[] => {
  const words: Word[] = [];
  const escape = dialect === "cmd" ? "^" : "\\";
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (blank.test(char)) {
      index += 1;
      continue;
    }
    if (dialect === "posix" && char === "#") {
      const close = source.indexOf("\n", index);
      index = close < 0 ? source.length : close;
      continue;
    }
    const start = index;
    plain_redirect.lastIndex = index;
    const redirected = plain_redirect.exec(source)?.[0] ?? "";
    if (redirected) {
      index += redirected.length;
      words.push({ raw: redirected, start, glued: false, op: redirected.includes("<") ? "<" : ">", pieces: [] });
      continue;
    }
    const pieces: Piece[] = [];
    let text = "";
    const flush = (quote: Quote) => {
      if (text || quote !== "none") pieces.push({ kind: "text", quote, text });
      text = "";
    };
    const group = char === "(";
    if (group) {
      const end = cmd_group_end(source, index);
      const closed = source[end - 1] === ")";
      pieces.push({ kind: "group", open: "(", text: source.slice(index + 1, closed ? end - 1 : end), start: index + 1 });
      index = end;
    }
    while (!group && index < source.length) {
      const current = source[index] ?? "";
      if (blank.test(current) || current === ">" || current === "<") break;
      if (current === escape) {
        text += source[index + 1] === "\n" || source[index + 1] === "\r" ? "" : (source[index + 1] ?? "");
        index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
        continue;
      }
      if (current === '"' || (dialect === "posix" && current === "'")) {
        flush("none");
        let end = index + 1;
        while (end < source.length && source[end] !== current) end += dialect === "posix" && current === '"' && source[end] === "\\" ? 2 : 1;
        end = Math.min(end, source.length);
        text = source.slice(index + 1, end);
        if (dialect === "posix" && current === '"') text = text.replace(/\\([\\$"`\n])/g, "$1");
        flush(current === "'" ? "single" : "double");
        index = end + 1;
        continue;
      }
      if (dialect === "posix" && current === "$" && source[index + 1] === "(") {
        flush("none");
        const end = skip_group(source, index + 1);
        pieces.push({ kind: "group", open: "$(", text: source.slice(index + 2, Math.max(index + 2, end - 1)), start: index + 2 });
        index = end;
        continue;
      }
      text += current;
      index += 1;
    }
    flush("none");
    words.push({ raw: source.slice(start, Math.min(index, source.length)), start, glued: false, op: "", pieces });
  }
  return words;
};

export const shell_words = (text: string, dialect: Dialect, mode: WordMode = "argument"): Word[] =>
  dialect === "cmd" || dialect === "posix" ? plain_words(text, dialect) : powershell_words(text, mode);


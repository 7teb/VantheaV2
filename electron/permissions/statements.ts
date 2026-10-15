import { split_pipelines_posix, split_statements_posix, statement_parts_posix } from "./statements-posix.ts";

export type Dialect = "powershell" | "cmd" | "posix" | "unknown";

export type StatementElement = { text: string; start: number };

export type StatementPart = { text: string; start: number; line: number; joiner: "" | "&&" | "||"; elements: StatementElement[] };

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

const inner_groups = (text: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (quote_of(char) === "'") {
      index = skip_quoted(text, index);
      continue;
    }
    if (quote_of(char) === '"') {
      const end = skip_quoted(text, index);
      groups.push(...inner_groups_in_string(text.slice(index + 1, end - 1)));
      index = end;
      continue;
    }
    if (char === "`") {
      index += 2;
      continue;
    }
    if (char === "(" || char === "{") {
      const end = skip_group(text, index);
      groups.push(text.slice(index + 1, Math.max(index + 1, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

const inner_groups_in_string = (text: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    if (text[index] === "`") {
      index += 2;
      continue;
    }
    if (text[index] === "$" && text[index + 1] === "(") {
      const end = skip_group(text, index + 1);
      groups.push(text.slice(index + 2, Math.max(index + 2, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

type Segment = { text: string; start: number; end: number; after: string };

const scan_segments = (source: string): Segment[] => {
  const segments: Segment[] = [];
  let current = "";
  let last = "";
  let begin = 0;
  let index = 0;
  const append = (text: string) => {
    current += text;
    last = text.at(-1) ?? last;
  };
  const cut = (after: string, next: number) => {
    segments.push({ text: current, start: begin, end: index, after });
    current = "";
    last = "";
    index = next;
    begin = next;
  };
  let string_end = false;
  while (index < source.length) {
    const char = source[index] ?? "";
    const token_start: boolean = string_end || last === "" || /[\s;|&(){}]/.test(last);
    string_end = false;
    if (quote_of(char)) {
      const end = skip_quoted(source, index);
      append(source.slice(index, end));
      index = end;
      string_end = token_start;
      continue;
    }
    if (char === "`") {
      const next = source[index + 1] ?? "";
      append(next === "\n" || next === "\r" ? " " : char + next);
      index += next === "\r" && source[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (char === "(" || char === "{") {
      const end = skip_group(source, index);
      append(source.slice(index, end));
      index = end;
      continue;
    }
    if (token_start && (char === "#" || (char === "<" && source[index + 1] === "#"))) {
      if (char === "<") append(" ");
      index = comment_end(source, index);
      continue;
    }
    if (token_start && source.startsWith("--%", index) && /^(?:\s|$)/.test(source.slice(index + 3, index + 4))) {
      const stop = source.slice(index).search(/[\r\n|]/);
      const end = stop < 0 ? source.length : index + stop;
      append(source.slice(index, end));
      index = end;
      continue;
    }
    if (char === "|") {
      const pair = source[index + 1] === "|";
      cut(pair ? "||" : "|", index + (pair ? 2 : 1));
      continue;
    }
    if (char === ";" || char === "\n" || char === "\r") {
      cut(char, index + (source[index + 1] === char && char !== "\n" ? 2 : 1));
      continue;
    }
    if (char === "&" && source[index + 1] === "&") {
      cut("&&", index + 2);
      continue;
    }
    append(char);
    index += 1;
  }
  segments.push({ text: current, start: begin, end: source.length, after: "" });
  return segments;
};

const cmd_segments = (source: string): Segment[] => {
  const segments: Segment[] = [];
  let begin = 0;
  let index = 0;
  let depth = 0;
  let quoted = false;
  let blank = true;
  const cut = (after: string, next: number) => {
    segments.push({ text: source.slice(begin, index), start: begin, end: index, after });
    index = next;
    begin = next;
    blank = true;
  };
  while (index < source.length) {
    const char = source[index] ?? "";
    if (blank && /^[ \t]*(?:rem(?=[\s.:]|$)|::)/i.test(source.slice(index, index + 8))) {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (!/\s/.test(char)) blank = false;
    if (char === '"') quoted = !quoted;
    else if (quoted && char !== "\n") {
      index += 1;
      continue;
    } else if (char === "^") {
      index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
      continue;
    } else if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    else if (char === "\n" || char === "\r") {
      quoted = false;
      if (depth === 0) {
        cut(char, index + 1);
        continue;
      }
    } else if (depth === 0 && (char === "&" || char === "|")) {
      const pair = source[index + 1] === char;
      cut(pair ? char + char : char === "&" ? ";" : "|", index + (pair ? 2 : 1));
      continue;
    }
    index += 1;
  }
  segments.push({ text: source.slice(begin), start: begin, end: source.length, after: "" });
  return segments;
};

const split_top_level = (source: string, split_pipes: boolean): string[] => {
  const parts: string[] = [];
  let current = "";
  for (const segment of scan_segments(source)) {
    current += segment.text;
    if (segment.after === "|" && !split_pipes) {
      current += "|";
      continue;
    }
    const text = current.trim();
    if (text) {
      parts.push(text);
    }
    current = "";
  }
  return parts;
};

export const statement_parts = (text: string, dialect: Dialect = "powershell"): StatementPart[] => {
  if (dialect === "posix") return statement_parts_posix(text);
  const parts: StatementPart[] = [];
  let elements: StatementElement[] = [];
  let joiner: StatementPart["joiner"] = "";
  let line = 1;
  let counted = 0;
  const line_at = (offset: number) => {
    for (let index = text.indexOf("\n", counted); index >= 0 && index < offset; index = text.indexOf("\n", index + 1)) line += 1;
    counted = Math.max(counted, offset);
    return line;
  };
  for (const segment of dialect === "cmd" ? cmd_segments(text) : scan_segments(text)) {
    const raw = text.slice(segment.start, segment.end);
    const lead = raw.length - raw.trimStart().length;
    if (segment.text.trim()) elements.push({ text: raw.trim(), start: segment.start + lead });
    if (segment.after === "|") continue;
    const first = elements[0];
    const last = elements.at(-1);
    if (first && last) {
      parts.push({ text: text.slice(first.start, last.start + last.text.length), start: first.start, line: line_at(first.start), joiner, elements });
    }
    elements = [];
    joiner = segment.after === "&&" || segment.after === "||" ? segment.after : "";
  }
  return parts;
};

const shell_launch = /^(?:&\s*)?["']?(?:[^"'\s]*[\\/])?(powershell|pwsh|cmd)(?:\.exe)?["']?(?=\s|$)([\s\S]*)$/i;

const unquote = (text: string) => {
  const value = text.trim();
  const quoted = value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return quoted ? value.slice(1, -1) : value;
};

const expression_launch = /^(?:invoke-expression|iex)\s+(?:-command\s+)?([\s\S]+)$/i;

const nested_payloads = (statement: string): string[] => {
  const expression = expression_launch.exec(statement.trim());
  if (expression) {
    return [unquote(expression[1] ?? "")];
  }
  const match = shell_launch.exec(statement.trim());
  if (!match) {
    return [];
  }
  const rest = match[2] ?? "";
  if ((match[1] ?? "").toLowerCase() === "cmd") {
    const payload = /(?:^|\s)\/[ck]\s+([\s\S]*)$/i.exec(rest);
    return payload ? [unquote(payload[1] ?? "").replace(/(?<!&)&(?!&)/g, ";")] : [];
  }
  const encoded = /(?:^|\s)-(?:encodedcommand|enc|ec|e)\s+([A-Za-z0-9+/=]+)/i.exec(rest);
  if (encoded) {
    return [Buffer.from(encoded[1] ?? "", "base64").toString("utf16le")];
  }
  const payload = /(?:^|\s)-(?:command|c)\s+([\s\S]*)$/i.exec(rest);
  return payload ? [unquote(payload[1] ?? "")] : [];
};

const split_recursive = (command: string, split_pipes: boolean): string[] => {
  const statements: string[] = [];
  const pending = [command];
  while (pending.length) {
    const source = pending.shift() ?? "";
    for (const statement of split_top_level(source, split_pipes)) {
      statements.push(statement);
      pending.push(...inner_groups(statement), ...nested_payloads(statement));
    }
  }
  return statements;
};

export const split_statements = (command: string, dialect: Dialect = "powershell"): string[] => (dialect === "posix" ? split_statements_posix(command) : split_recursive(command, true));

export const split_pipelines = (command: string, dialect: Dialect = "powershell"): string[] => (dialect === "posix" ? split_pipelines_posix(command) : split_recursive(command, false));

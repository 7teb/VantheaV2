import { backtick_end, body_end, brace_end, dollar_single_end, double_end, feeds_shell, heredoc, paren_end, single_end, token_boundary } from "./posix-lex.ts";
import { head_index, is_flag, posix_literal } from "./posix-command.ts";
import { shell_words, type Word } from "./shell-words.ts";
import type { StatementElement, StatementPart } from "./statements.ts";

type Separator = ";" | "&&" | "||" | "|" | "|&" | "&" | "\n" | "";

type Segment = { text: string; start: number; end: number; after: Separator };

export type PosixPipeline = { stages: StatementElement[]; nested: string[]; simple: boolean };

const scan_posix = (source: string, payloads: string[]): Segment[] => {
  const segments: Segment[] = [];
  let begin = 0;
  let index = 0;
  let heredocs: { tag: string; dashed: boolean; expands: boolean }[] = [];
  const cut = (after: Separator, next: number) => {
    segments.push({ text: source.slice(begin, index), start: begin, end: index, after });
    index = next;
    begin = next;
  };
  while (index < source.length) {
    const char = source[index] ?? "";
    const prev = source[index - 1];
    if (char === "'") {
      index = single_end(source, index);
      continue;
    }
    if (char === "$" && source[index + 1] === "'") {
      index = dollar_single_end(source, index);
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
      index += source[index + 1] === "\r" && source[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (char === "#" && token_boundary(prev)) {
      const stop = source.indexOf("\n", index);
      index = stop < 0 ? source.length : stop;
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      const close = source.indexOf("}", index + 2);
      index = close < 0 ? source.length : close + 1;
      continue;
    }
    if ((char === "$" || char === "<" || char === ">") && source[index + 1] === "(") {
      index = paren_end(source, index + 1);
      continue;
    }
    if (char === "(" && token_boundary(prev)) {
      index = paren_end(source, index);
      continue;
    }
    if (char === "{" && token_boundary(prev) && /\s/.test(source[index + 1] ?? "")) {
      index = brace_end(source, index);
      continue;
    }
    if (char === "<" && source[index + 1] === "<" && source[index + 2] === "<") {
      index += 3;
      while (index < source.length && (source[index] === " " || source[index] === "\t")) index += 1;
      const word = shell_words(source.slice(index), "posix")[0];
      if (word) {
        const value = posix_literal(word);
        if (value !== null && feeds_shell.test(source.slice(begin, index))) payloads.push(value);
        index += word.start + word.raw.length;
      }
      continue;
    }
    if (char === "<" && source[index + 1] === "<" && source[index + 2] !== "&") {
      const match = heredoc.exec(source.slice(index));
      if (match) {
        heredocs.push({ tag: match[3] ?? match[4] ?? "", dashed: match[1] === "-", expands: match[4] !== undefined && !match[0].includes("\\") });
        index += match[0].length;
        continue;
      }
    }
    if (char === "|") {
      const amp = source[index + 1] === "&";
      cut(amp ? "|&" : "|", index + (amp ? 2 : 1));
      continue;
    }
    if (char === "&" && source[index + 1] === "&") {
      cut("&&", index + 2);
      continue;
    }
    if (char === "&") {
      if (prev === ">" || prev === "<" || source[index + 1] === ">") {
        index += 1;
        continue;
      }
      cut("&", index + 1);
      continue;
    }
    if (char === ";") {
      cut(";", index + 1);
      continue;
    }
    if (char === "\n" || char === "\r") {
      const resume = index + (char === "\r" && source[index + 1] === "\n" ? 2 : 1);
      if (heredocs.length) {
        const feeds = feeds_shell.test(source.slice(begin, index));
        let pos = resume;
        for (const entry of heredocs) {
          if (!entry.tag) continue;
          const { body, next } = body_end(source, pos, entry.tag, entry.dashed);
          if (body && feeds) payloads.push(body);
          if (!feeds && entry.expands) payloads.push(...inner_in_double(body));
          pos = next;
        }
        heredocs = [];
        cut("\n", pos);
        continue;
      }
      cut("\n", resume);
      continue;
    }
    index += 1;
  }
  cut("", source.length);
  return segments;
};

const inner_groups = (statement: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < statement.length) {
    const char = statement[index] ?? "";
    const prev = statement[index - 1];
    if (char === "'") {
      index = single_end(statement, index);
      continue;
    }
    if (char === "$" && statement[index + 1] === "'") {
      index = dollar_single_end(statement, index);
      continue;
    }
    if (char === '"') {
      const end = double_end(statement, index);
      groups.push(...inner_in_double(statement.slice(index + 1, Math.max(index + 1, end - 1))));
      index = end;
      continue;
    }
    if (char === "`") {
      const end = backtick_end(statement, index);
      groups.push(statement.slice(index + 1, Math.max(index + 1, end - 1)).replace(/\\([$`\\])/g, "$1"));
      index = end;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if ((char === "$" || char === "<" || char === ">") && statement[index + 1] === "(") {
      const end = paren_end(statement, index + 1);
      groups.push(statement.slice(index + 2, Math.max(index + 2, end - 1)));
      index = end;
      continue;
    }
    if (char === "(" && token_boundary(prev)) {
      const end = paren_end(statement, index);
      groups.push(statement.slice(index + 1, Math.max(index + 1, end - 1)));
      index = end;
      continue;
    }
    if (char === "{" && token_boundary(prev) && /\s/.test(statement[index + 1] ?? "")) {
      const end = brace_end(statement, index);
      groups.push(statement.slice(index + 1, Math.max(index + 1, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

const inner_in_double = (text: string): string[] => {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = backtick_end(text, index);
      groups.push(text.slice(index + 1, Math.max(index + 1, end - 1)).replace(/\\([$`\\])/g, "$1"));
      index = end;
      continue;
    }
    if (char === "$" && text[index + 1] === "(") {
      const end = paren_end(text, index + 1);
      groups.push(text.slice(index + 2, Math.max(index + 2, end - 1)));
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

const shell_feeders = new Set(["bash", "sh", "dash"]);

const combined_c = /^-[a-z]*c$/i;

const shell_c_payload = (rest: Word[]): string | null => {
  let command = false;
  let index = 0;
  while (index < rest.length) {
    const raw = (rest[index] as Word).raw;
    if (!/^[-+]/.test(raw)) break;
    index += 1;
    if (raw === "--" || raw === "-") break;
    if (raw.startsWith("--")) {
      if (raw === "--rcfile" || raw === "--init-file") index += 1;
      continue;
    }
    if (raw.startsWith("-") && raw.includes("c")) command = true;
    index += raw.match(/o/gi)?.length ?? 0;
  }
  return command ? posix_literal(rest[index]) : null;
};

const command_payloads = (statement: string): string[] => {
  const words = shell_words(statement, "posix");
  const { verb, at } = head_index(words);
  const rest = words.slice(at + 1);
  if (verb === "eval") {
    const first = rest.find((word) => !is_flag(word));
    const value = first ? posix_literal(first) : null;
    return value ? [value] : [];
  }
  if (shell_feeders.has(verb)) {
    const value = shell_c_payload(rest);
    return value ? [value] : [];
  }
  return [];
};

const echo_payload = (words: Word[], at: number): string =>
  words
    .slice(at + 1)
    .filter((word) => !is_flag(word))
    .map(posix_literal)
    .filter((value): value is string => value !== null)
    .join(" ");

const pipeline_fed = (stages: StatementElement[]): string[] => {
  const heads = stages.map((stage) => {
    const words = shell_words(stage.text, "posix");
    return { words, ...head_index(words) };
  });
  const payloads: string[] = [];
  for (let stage = 1; stage < heads.length; stage += 1) {
    const sink = heads[stage] as (typeof heads)[number];
    if (!shell_feeders.has(sink.verb) || sink.words.slice(sink.at + 1).some((word) => combined_c.test(word.raw))) continue;
    for (let source = 0; source < stage; source += 1) {
      const feed = heads[source] as (typeof heads)[number];
      if (/^(?:echo|printf)$/.test(feed.verb)) {
        const text = echo_payload(feed.words, feed.at);
        if (text) payloads.push(text);
      }
    }
  }
  return payloads;
};

const split_top_level = (source: string, split_pipes: boolean, payloads: string[]): string[] => {
  const parts: string[] = [];
  let current = "";
  for (const segment of scan_posix(source, payloads)) {
    current += segment.text;
    if (!split_pipes && (segment.after === "|" || segment.after === "|&")) {
      current += segment.after;
      continue;
    }
    const text = current.trim();
    if (text) parts.push(text);
    current = "";
  }
  return parts;
};

const split_recursive = (command: string, split_pipes: boolean): string[] => {
  const statements: string[] = [];
  const pending = [String(command || "")];
  while (pending.length) {
    const source = pending.shift() ?? "";
    const payloads: string[] = [];
    for (const statement of split_top_level(source, split_pipes, payloads)) {
      statements.push(statement);
      pending.push(...inner_groups(statement), ...command_payloads(statement));
    }
    pending.push(...payloads);
  }
  return statements;
};

export const split_statements_posix = (command: string): string[] => split_recursive(command, true);

export const split_pipelines_posix = (command: string): string[] => split_recursive(command, false);

export const posix_script = (command: string): { pipelines: PosixPipeline[]; payloads: string[] } => {
  const payloads: string[] = [];
  const pipelines: PosixPipeline[] = [];
  let stages: StatementElement[] = [];
  const flush = () => {
    if (!stages.length) return;
    const nested: string[] = [];
    for (const stage of stages) nested.push(...inner_groups(stage.text), ...command_payloads(stage.text));
    nested.push(...pipeline_fed(stages));
    pipelines.push({ stages, nested, simple: stages.length === 1 });
    stages = [];
  };
  for (const segment of scan_posix(String(command || ""), payloads)) {
    const raw = segment.text;
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) stages.push({ text: raw.trim(), start: segment.start + lead });
    if (segment.after === "|" || segment.after === "|&") continue;
    flush();
  }
  flush();
  return { pipelines, payloads };
};

export const statement_parts_posix = (text: string): StatementPart[] => {
  const parts: StatementPart[] = [];
  let elements: StatementElement[] = [];
  let joiner: StatementPart["joiner"] = "";
  const payloads: string[] = [];
  const flush = (next: StatementPart["joiner"]) => {
    const first = elements[0];
    const last = elements.at(-1);
    if (first && last) {
      parts.push({ text: text.slice(first.start, last.start + last.text.length), start: first.start, line: 1, joiner, elements });
    }
    elements = [];
    joiner = next;
  };
  for (const segment of scan_posix(text, payloads)) {
    const raw = segment.text;
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) elements.push({ text: raw.trim(), start: segment.start + lead });
    if (segment.after === "|" || segment.after === "|&") continue;
    flush(segment.after === "&&" || segment.after === "||" ? segment.after : "");
  }
  return parts;
};

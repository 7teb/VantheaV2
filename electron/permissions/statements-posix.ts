import { backtick_end, body_end, brace_end, case_head, case_keyword, case_pattern, dollar_single_end, double_end, parameter_end, paren_end, single_end, token_boundary, word_end, type CaseFrame, type CaseGroup } from "./posix-lex.ts";
import { head_index, is_flag, posix_literal } from "./posix-command.ts";
import { heredoc_word, script_input, shell_feeders, shell_mode } from "./posix-heredoc.ts";
import { shell_words, type Word } from "./shell-words.ts";
import { inner_groups, inner_in_double } from "./posix-groups.ts";
import type { StatementElement, StatementPart } from "./statements.ts";

type Separator = ";" | "&&" | "||" | "|" | "|&" | "&" | "\n" | "";

type Segment = { text: string; start: number; end: number; after: Separator; group?: CaseGroup };

export type PosixPipeline = { stages: StatementElement[]; nested: string[]; simple: boolean };

const scan_posix = (source: string, payloads: string[]): Segment[] => {
  const segments: Segment[] = [];
  let begin = 0;
  let index = 0;
  const cases: CaseFrame[] = [];
  let strings: { value: string; feeds: boolean }[] = [];
  let heredocs: { tag: string; dashed: boolean; expands: boolean; feeds: boolean; end: number | null }[] = [];
  const mark_feeds = () => {
    if (!script_input(source.slice(begin, index))) return;
    for (const entry of strings) {
      entry.feeds = true;
    }
    for (const entry of heredocs) {
      if (entry.end === null) {
        entry.feeds = true;
      }
    }
  };
  const cut = (after: Separator, next: number) => {
    mark_feeds();
    if (after !== "|" && after !== "|&") {
      payloads.push(...strings.filter((entry) => entry.feeds).map((entry) => entry.value));
      strings = [];
      for (const entry of heredocs) {
        if (entry.end === null) {
          entry.end = index;
        }
      }
    }
    segments.push({ text: source.slice(begin, index), start: begin, end: index, after, group: cases[0]?.root });
    index = next;
    begin = next;
  };
  while (index < source.length) {
    const frame = cases.at(-1);
    if (frame?.pattern) {
      const pattern = case_pattern(source, index);
      for (const entry of pattern.expansions) {
        frame.root.expansions.push(...inner_groups(entry.text, entry.start, frame.root.expressions));
      }
      if (pattern.closed) {
        cases.pop();
      } else {
        frame.pattern = false;
        frame.body = pattern.end;
      }
      index = begin = pattern.end;
      continue;
    }
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
    const header = char === "c" ? case_head(source, index, begin) : -1;
    if (header >= 0) {
      cut("", index);
      const expressions: StatementElement[] = [];
      const group: CaseGroup = { branches: [], expansions: inner_groups(source.slice(index, header), index, expressions), expressions };
      cases.push({ group, root: cases[0]?.root ?? group, pattern: true, body: header });
      segments.push({ text: "", start: index, end: header, after: "", group: cases[0]?.root });
      if (cases.length > 1) {
        cases[0]?.root.expansions.push(...group.expansions);
        cases[0]?.root.expressions.push(...group.expressions);
      }
      index = begin = header;
      continue;
    }
    const closed = frame && char === "e" ? case_keyword(source, index, "esac") : -1;
    if (closed >= 0 && !source.slice(begin, index).replace(/\\\r?\n/g, "").trim()) {
      if (frame === cases[0]) {
        frame.group.branches.push({ start: frame.body, end: index });
      }
      cut("", index);
      cases.pop();
      index = begin = closed;
      continue;
    }
    if (char === "$" && source[index + 1] === "{") {
      index = parameter_end(source, index);
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
      const end = word_end(source, index);
      const word = shell_words(source.slice(index, end), "posix")[0];
      if (word) {
        const value = posix_literal(word);
        if (value !== null) {
          strings.push({ value, feeds: false });
        }
      }
      index = end;
      continue;
    }
    if (char === "<" && source[index + 1] === "<" && source[index + 2] !== "&") {
      const dashed = source[index + 2] === "-";
      let from = index + (dashed ? 3 : 2);
      while (source[from] === " " || source[from] === "\t") {
        from += 1;
      }
      const end = word_end(source, from);
      if (end > from) {
        const raw = source.slice(from, end);
        const word = heredoc_word(raw);
        if (word) {
          heredocs.push({ ...word, dashed, feeds: false, end: null });
        }
        index = end;
        continue;
      }
    }
    if (char === "|") {
      if (source[index + 1] === "|") {
        cut("||", index + 2);
        continue;
      }
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
      const ending = frame ? /^(?:;;&|;;|;&)/.exec(source.slice(index))?.[0] : "";
      if (frame && ending) {
        if (frame === cases[0]) {
          frame.group.branches.push({ start: frame.body, end: index });
        }
        cut(";", index + ending.length);
        frame.pattern = true;
        continue;
      }
      cut(";", index + 1);
      continue;
    }
    if (char === "\n" || char === "\r") {
      const resume = index + (char === "\r" && source[index + 1] === "\n" ? 2 : 1);
      if (heredocs.length) {
        mark_feeds();
        let pos = resume;
        for (const entry of heredocs) {
          const { body, next } = body_end(source, pos, entry.tag, entry.dashed);
          if (body && entry.feeds) {
            payloads.push(body);
          }
          if (!entry.feeds && entry.expands) {
            payloads.push(...inner_in_double(body));
          }
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
    const value = shell_mode(rest).payload;
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
    if (!shell_feeders.has(sink.verb) || !shell_mode(sink.words.slice(sink.at + 1)).stdin) continue;
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
  const groups = new Set<CaseGroup>();
  for (const segment of scan_posix(source, payloads)) {
    if (segment.group && !groups.has(segment.group)) {
      groups.add(segment.group);
      payloads.push(...segment.group.expansions);
    }
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
  const groups = new Set<CaseGroup>();
  const flush = () => {
    if (!stages.length) return;
    const nested: string[] = [];
    for (const stage of stages) nested.push(...inner_groups(stage.text), ...command_payloads(stage.text));
    nested.push(...pipeline_fed(stages));
    pipelines.push({ stages, nested, simple: stages.length === 1 });
    stages = [];
  };
  for (const segment of scan_posix(String(command || ""), payloads)) {
    if (segment.group) {
      flush();
      if (!groups.has(segment.group)) {
        groups.add(segment.group);
        pipelines.push({ stages: [], nested: [...segment.group.expansions, ...segment.group.branches.map((branch) => command.slice(branch.start, branch.end))], simple: false });
      }
      continue;
    }
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
  const groups = new Set<CaseGroup>();
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
    if (segment.group && !groups.has(segment.group)) {
      groups.add(segment.group);
      for (const entry of segment.group.expressions) {
        parts.push({ text: entry.text, start: entry.start, line: 1, joiner: "", elements: [entry] });
      }
    }
    const raw = segment.text;
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) elements.push({ text: raw.trim(), start: segment.start + lead });
    if (segment.after === "|" || segment.after === "|&") continue;
    flush(segment.after === "&&" || segment.after === "||" ? segment.after : "");
  }
  return parts.sort((a, b) => a.start - b.start);
};

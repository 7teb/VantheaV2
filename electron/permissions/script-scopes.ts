import type { SourceLanguage } from "./script-constants.ts";

export type Scope = { start: number; end: number };

export type LocalBinding = { name: string; at: number; value: number; scope: Scope };

export type ScriptShape = { masked: string; language: SourceLanguage; open: Int32Array; pairs: Map<number, number>; targets: Scope[] };

type Line = { start: number; indent: number };

type Block = Scope & { function: boolean };

const python_header = /(?:(?:async[ \t]+)?(def)|class)[ \t]/y;

const python_local = /([A-Za-z_]\w*)[ \t]*=(?!=)/y;

const python_assign = /^\s*(?:[-+*/%&|^@]|\*\*|\/\/|>>|<<)?=(?!=)/;

const python_binder = /\b(?:as|global|nonlocal|del|import)\b[^\n:=]*$|\b(?:def|class)\s+$|^[ \t]*case\b|\blambda\b[^:]*$/;

const js_local = /(?<![\w$.])(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])/g;

const js_assign = /^\s*(?:(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?!=)|\+\+|--)/;

const js_binder = /(?:\+\+|--)\s*$|\b(?:function|class)\s*\*?\s*$/;

const js_continues = /[.?:+\-*/%&|^,=<>([]/;

export const script_shape = (masked: string, language: SourceLanguage): ScriptShape => {
  const open = new Int32Array(masked.length).fill(-1);
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if (")]}".includes(char) && stack.length) {
      const start = stack.pop() ?? -1;
      pairs.set(start, index);
      pairs.set(index, start);
    }
    open[index] = stack.at(-1) ?? -1;
    if ("([{".includes(char)) stack.push(index);
  }
  return { masked, language, open, pairs, targets: language === "python" ? assignment_targets(masked) : [] };
};

const line_text = (masked: string, end: number): string => masked.slice(masked.lastIndexOf("\n", end - 1) + 1, end);

const continued = (masked: string, newline: number): boolean => /\\\s*$/.test(line_text(masked, newline));

const logical_text = (masked: string, end: number): string => {
  let start = masked.lastIndexOf("\n", end - 1);
  while (start > 0 && continued(masked, start)) start = masked.lastIndexOf("\n", start - 1);
  return masked.slice(start + 1, end).replace(/\\[ \t]*\r?\n/g, " ");
};

const enclosing = (shape: ScriptShape, at: number): number[] => {
  const chain: number[] = [];
  for (let index = shape.open[at] ?? -1; index >= 0; index = shape.open[index] ?? -1) chain.push(index);
  return chain;
};

const last_code = (masked: string, before: number): number => {
  let index = before - 1;
  while (index >= 0 && /\s/.test(masked[index] ?? "")) index -= 1;
  return index;
};

export const statement_end = (masked: string, start: number, language: SourceLanguage): number | null => {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0 && (char === ";" || (language === "js" && char === ","))) return index;
    else if (depth === 0 && char === "\n") {
      if (language === "python") {
        if (!continued(masked, index)) return index;
        continue;
      }
      return js_continues.test(/\S/.exec(masked.slice(index))?.[0] ?? "") ? null : index;
    }
  }
  return masked.length;
};

const python_lines = (masked: string): Line[] => {
  const lines: Line[] = [];
  let depth = 0;
  let joined = false;
  let offset = 0;
  for (const raw of masked.split("\n")) {
    if (depth === 0 && !joined && raw.trim()) lines.push({ start: offset, indent: /^[ \t]*/.exec(raw)?.[0].length ?? 0 });
    for (const char of raw) {
      if ("([{".includes(char)) depth += 1;
      else if (")]}".includes(char)) depth = Math.max(0, depth - 1);
    }
    joined = /\\\s*$/.test(raw);
    offset += raw.length + 1;
  }
  return lines;
};

const python_blocks = (masked: string, lines: Line[]): Block[] =>
  lines.flatMap((line, index) => {
    python_header.lastIndex = line.start + line.indent;
    const header = python_header.exec(masked);
    if (!header) return [];
    let close = index + 1;
    while (close < lines.length && (lines[close]?.indent ?? 0) > line.indent) close += 1;
    return [{ start: line.start, end: lines[close]?.start ?? masked.length, function: header[1] === "def" }];
  });

const assignment = (masked: string, index: number): boolean => {
  const before = masked.slice(Math.max(0, index - 2), index);
  return masked[index + 1] !== "=" && (!/[=!<>:]$/.test(before) || /(?:<<|>>)$/.test(before));
};

const assignment_targets = (masked: string): Scope[] => {
  const targets: Scope[] = [];
  let depth = 0;
  let begin = 0;
  let last = -1;
  const close = (at: number) => {
    if (last >= 0) targets.push({ start: begin, end: last });
    begin = at + 1;
    last = -1;
  };
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index] ?? "";
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === ";" || (char === "\n" && !continued(masked, index)))) close(index);
    else if (depth === 0 && char === "=" && assignment(masked, index)) last = index;
  }
  close(masked.length);
  return targets;
};

export const last_start = <T extends Scope>(sorted: T[], at: number): number => {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle]?.start ?? 0) <= at) low = middle + 1;
    else high = middle - 1;
  }
  return high;
};

const python_write = (shape: ScriptShape, at: number, name: string): boolean => {
  const { masked, targets } = shape;
  const line_end = masked.indexOf("\n", at);
  const after = masked.slice(at + name.length, line_end < 0 ? masked.length : line_end);
  const back = logical_text(masked, at);
  const chain = enclosing(shape, at);
  const signature = chain.some((index) => masked[index] === "(" && /\b(?:def\s+\w+|import)\s*$/.test(line_text(masked, index)));
  const target = targets[last_start(targets, at)];
  if (signature || /^\s*:=/.test(after) || (target !== undefined && at < target.end)) return true;
  if (python_assign.test(after)) {
    const inner = chain[0] ?? -1;
    return !(inner >= 0 && masked[inner] === "(" && /[(,]/.test(masked[last_code(masked, at)] ?? ""));
  }
  if (python_binder.test(back)) return true;
  return /\bfor\b(?:(?!\bin\b)[^:])*$/.test(back) && /^[^:]*?\bin\b/.test(after);
};

const js_function_body = (shape: ScriptShape, brace: number): boolean => {
  const { masked } = shape;
  const end = last_code(masked, brace);
  if (masked.slice(end - 1, end + 1) === "=>") return true;
  if (masked[end] !== ")") return false;
  const paren = shape.pairs.get(end) ?? 0;
  return !/(?<![\w$.])(?:if|for|while|switch|catch|with)\s*$/.test(masked.slice(Math.max(0, paren - 16), paren));
};

const js_write = (shape: ScriptShape, at: number, name: string): boolean => {
  const { masked } = shape;
  const after = masked.slice(at + name.length, at + name.length + 8);
  const back = masked.slice(Math.max(0, at - 400), at);
  const statement = back.slice(Math.max(back.lastIndexOf(";"), back.lastIndexOf("{"), back.lastIndexOf("}")) + 1);
  if (js_assign.test(after) || js_binder.test(back) || /\b(?:const|let|var)\s+[^;=]*$/.test(statement)) return true;
  for (const index of enclosing(shape, at)) {
    const close = shape.pairs.get(index);
    const tail = close === undefined ? "" : masked.slice(close + 1, close + 64);
    if (masked[index] !== "(") {
      if (/^\s*=(?![=>])/.test(tail)) return true;
      continue;
    }
    const head = masked.slice(Math.max(0, index - 16), index);
    if (/(?<![\w$.])for\s*(?:await\s*)?$/.test(head)) {
      if (!masked.slice(index, at).includes(";") && /\b(?:of|in)\b/.test(masked.slice(at, close))) return true;
      continue;
    }
    if (/^\s*(?:=>|\{)/.test(tail) && !/(?<![\w$.])(?:if|while|switch|with)\s*$/.test(head)) return true;
  }
  return false;
};

export const write_at = (shape: ScriptShape, at: number, name: string): boolean =>
  shape.language === "python" ? python_write(shape, at, name) : js_write(shape, at, name);

export const name_writes = (shape: ScriptShape, name: string, scope: Scope, bare = false): number => {
  const python = shape.language === "python";
  const escaped = name.replaceAll("$", "\\$");
  const pattern = new RegExp(python ? String.raw`(?<![\w.])${escaped}(?!\w)` : String.raw`(?<![\w$])(?<![^.]\.)(?<!^\.)${escaped}(?![\w$])`, "g");
  pattern.lastIndex = scope.start;
  let count = 0;
  for (let match = pattern.exec(shape.masked); match && match.index < scope.end; match = pattern.exec(shape.masked)) {
    if (bare && /^\s*[.[]/.test(shape.masked.slice(match.index + name.length, match.index + name.length + 16))) continue;
    if (write_at(shape, match.index, name)) count += 1;
  }
  return count;
};

export const hidden_uses = (shape: ScriptShape, clean: string, name: string, scope: Scope): { uses: number; writes: number } => {
  const python = shape.language === "python";
  const escaped = name.replaceAll("$", "\\$");
  const pattern = new RegExp(String.raw`(?<![\w$.])${escaped}(?![\w$])`, "g");
  let uses = 0;
  let writes = 0;
  pattern.lastIndex = scope.start;
  for (let match = pattern.exec(clean); match && match.index < scope.end; match = pattern.exec(clean)) {
    if (shape.masked[match.index] !== " ") continue;
    uses += 1;
    const after = clean.slice(match.index + name.length, match.index + name.length + 8);
    const before = clean.slice(Math.max(0, match.index - 16), match.index);
    if (python ? /^\s*:=/.test(after) : (js_assign.test(after) || js_binder.test(before))) writes += 1;
  }
  return { uses, writes };
};

const python_bindings = (shape: ScriptShape): LocalBinding[] => {
  const { masked } = shape;
  const lines = python_lines(masked);
  const blocks = python_blocks(masked, lines);
  const open: Block[] = [];
  const found: LocalBinding[] = [];
  let pending = 0;
  for (const line of lines) {
    while (open.length && (open.at(-1)?.end ?? 0) <= line.start) open.pop();
    const block = open.at(-1);
    for (let entry = blocks[pending]; entry?.start === line.start; entry = blocks[++pending]) open.push(entry);
    python_local.lastIndex = line.start + line.indent;
    const match = line.indent ? python_local.exec(masked) : null;
    if (!match || !block?.function) continue;
    const scope = { start: block.start, end: block.end };
    const name = match[1] ?? "";
    const end = line.start + line.indent + match[0].length;
    if (name_writes(shape, name, scope) === 1) found.push({ name, at: line.start + line.indent, value: end, scope });
  }
  return found;
};

const js_bindings = (shape: ScriptShape): LocalBinding[] => {
  const { masked } = shape;
  const found: LocalBinding[] = [];
  for (const match of masked.matchAll(js_local)) {
    const start = match.index ?? 0;
    if (/(?<![\w$.])for\s*(?:await\s*)?\(\s*$/.test(masked.slice(Math.max(0, start - 16), start))) continue;
    const braces = enclosing(shape, start).filter((index) => masked[index] === "{");
    const functions = braces.filter((index) => js_function_body(shape, index));
    const block = match[1] === "var" ? functions[0] : braces[0];
    if (block === undefined || !functions.length) continue;
    const scope = { start: block, end: (shape.pairs.get(block) ?? masked.length - 1) + 1 };
    const name = match[2] ?? "";
    const end = start + match[0].length;
    if (name_writes(shape, name, scope) === 1) found.push({ name, at: start + match[0].indexOf(name, match[1]?.length), value: end, scope });
  }
  return found;
};

export const local_bindings = (shape: ScriptShape): LocalBinding[] => (shape.language === "python" ? python_bindings(shape) : js_bindings(shape));

export const python_free_functions = (masked: string): Scope[] => {
  const blocks = python_blocks(masked, python_lines(masked));
  const classes = blocks.filter((block) => !block.function);
  return blocks.flatMap((block) => (block.function && !classes.some((owner) => owner.start < block.start && block.start < owner.end) ? [{ start: block.start, end: block.end }] : []));
};

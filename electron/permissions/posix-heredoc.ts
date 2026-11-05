import { backtick_end, dollar_single_end, double_end, parameter_end, paren_end, single_end } from "./posix-lex.ts";
import { head_index, posix_literal } from "./posix-command.ts";
import { shell_words, type Word } from "./shell-words.ts";

export const shell_feeders = new Set(["bash", "sh", "dash"]);

export const shell_mode = (rest: Word[]): { payload: string | null; stdin: boolean } => {
  let command = false;
  let stdin = false;
  let index = 0;
  while (index < rest.length) {
    const raw = (rest[index] as Word).raw;
    if (!/^[-+]/.test(raw)) break;
    index += 1;
    if (raw === "--" || raw === "-") {
      if (raw === "-") {
        stdin = true;
      }
      break;
    }
    if (raw.startsWith("--")) {
      if (raw === "--rcfile" || raw === "--init-file") {
        index += 1;
      }
      continue;
    }
    if (raw.startsWith("-") && raw.includes("c")) {
      command = true;
    }
    if (raw.startsWith("-") && raw.includes("s")) {
      stdin = true;
    }
    index += raw.match(/o/gi)?.length ?? 0;
  }
  return { payload: command ? posix_literal(rest[index]) : null, stdin: !command && (stdin || index >= rest.length) };
};

export const script_input = (text: string): boolean => {
  const words = shell_words(text, "posix");
  const plain: Word[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as Word;
    const next = words[index + 1];
    if (!word.op && next?.op && ((/^\d+$/.test(word.raw) && word.start + word.raw.length === next.start) || (word.raw === "&" && next.op === ">"))) continue;
    if (word.op) {
      while (words[index + 1]?.op) {
        index += 1;
      }
      if (!/>&[1-6]$/.test((words[index] as Word).raw)) {
        index += 1;
      }
      continue;
    }
    plain.push(word);
  }
  const { verb, at } = head_index(plain);
  return verb === "eval" || (shell_feeders.has(verb) && shell_mode(plain.slice(at + 1)).stdin);
};

const expansion_end = (raw: string, index: number, parameter: boolean, substitution: boolean): number => {
  if (parameter) return parameter_end(raw, index);
  if (substitution) return paren_end(raw, index + 1);
  return backtick_end(raw, index);
};

const quoted_end = (raw: string, index: number, char: string | undefined, next: string | undefined, locale: boolean): number => {
  if (char === "$" && next === "'") return dollar_single_end(raw, index);
  if (char === "'") return single_end(raw, index);
  return double_end(raw, locale ? index + 1 : index);
};

export const heredoc_word = (raw: string): { tag: string; expands: boolean } | null => {
  let tag = "";
  let expands = true;
  let index = 0;
  let begin = 0;
  const append = (text: string): boolean => {
    if (!text) return true;
    const word = shell_words(text, "posix")[0];
    const value = posix_literal(word);
    if (word?.raw !== text || value === null) return false;
    tag += value;
    return true;
  };
  while (index < raw.length) {
    const char = raw[index];
    const next = raw[index + 1];
    const parameter = char === "$" && next === "{";
    const substitution = (char === "$" || char === "<" || char === ">") && next === "(";
    if (parameter || substitution || char === "`") {
      if (!append(raw.slice(begin, index))) return null;
      const end = expansion_end(raw, index, parameter, substitution);
      tag += raw.slice(index, end);
      begin = index = end;
      continue;
    }
    if (char === "'" || char === '"' || (char === "$" && (next === "'" || next === '"'))) {
      if (!append(raw.slice(begin, index))) return null;
      const locale = char === "$" && next === '"';
      const end = quoted_end(raw, index, char, next, locale);
      if (!append(raw.slice(locale ? index + 1 : index, end))) return null;
      expands = false;
      begin = index = end;
      continue;
    }
    if (char === "\\") {
      const continuation = next === "\n" || (next === "\r" && raw[index + 2] === "\n");
      if (!continuation) {
        expands = false;
      }
      index += next === "\r" && raw[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    index += 1;
  }
  return append(raw.slice(begin)) ? { tag, expands } : null;
};

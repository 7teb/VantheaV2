import { backtick_end, brace_end, dollar_single_end, double_end, paren_end, single_end, token_boundary } from "./posix-lex.ts";
import type { StatementElement } from "./statements.ts";

export const inner_groups = (statement: string, base = 0, entries?: StatementElement[]): string[] => {
  const groups: string[] = [];
  const add = (text: string, start: number) => { groups.push(text); entries?.push({ text, start: base + start }); };
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
      groups.push(...inner_in_double(statement.slice(index + 1, Math.max(index + 1, end - 1)), base + index + 1, entries));
      index = end;
      continue;
    }
    if (char === "`") {
      const end = backtick_end(statement, index);
      add(statement.slice(index + 1, Math.max(index + 1, end - 1)).replace(/\\([$`\\])/g, "$1"), index + 1);
      index = end;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if ((char === "$" || char === "<" || char === ">") && statement[index + 1] === "(") {
      const end = paren_end(statement, index + 1);
      add(statement.slice(index + 2, Math.max(index + 2, end - 1)), index + 2);
      index = end;
      continue;
    }
    if (char === "(" && token_boundary(prev)) {
      const end = paren_end(statement, index);
      add(statement.slice(index + 1, Math.max(index + 1, end - 1)), index + 1);
      index = end;
      continue;
    }
    if (char === "{" && token_boundary(prev) && /\s/.test(statement[index + 1] ?? "")) {
      const end = brace_end(statement, index);
      add(statement.slice(index + 1, Math.max(index + 1, end - 1)), index + 1);
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

export const inner_in_double = (text: string, base = 0, entries?: StatementElement[]): string[] => {
  const groups: string[] = [];
  const add = (source: string, start: number) => { groups.push(source); entries?.push({ text: source, start: base + start }); };
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      const end = backtick_end(text, index);
      add(text.slice(index + 1, Math.max(index + 1, end - 1)).replace(/\\([$`\\])/g, "$1"), index + 1);
      index = end;
      continue;
    }
    if (char === "$" && text[index + 1] === "(") {
      const end = paren_end(text, index + 1);
      add(text.slice(index + 2, Math.max(index + 2, end - 1)), index + 2);
      index = end;
      continue;
    }
    index += 1;
  }
  return groups;
};

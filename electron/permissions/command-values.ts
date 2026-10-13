import path from "node:path";
import { shell_words, type Piece, type Word } from "./shell-words.ts";
import { skip_group, statement_parts, type Dialect } from "./statements.ts";

export type Value = { values: string[]; maybe_unset: boolean; list?: boolean } | { unresolved: string };

export type ValueState = {
  vars: Map<string, Value>;
  env: Map<string, Value>;
  base_env: Map<string, string>;
  vars_reason: string;
  env_reason: string;
  script_path: string;
  pwd?: Value;
};

export type Assignment = { target: "variable" | "env" | "poison"; names: string[]; cast: string; rhs: string; rhs_start: number; append: boolean };

const max_values = 8;

const unset: Value = { values: [], maybe_unset: true };

const reference = /^\$(?:\{([^}]+)\}|([\w?]+(?::[\w?]+)?))/;

const automatic = new Set(["_", "psitem", "args", "input", "matches", "pwd", "home", "lastexitcode", "host", "myinvocation", "pscmdlet", "psboundparameters", "error", "executioncontext", "profile", "pshome", "pid", "shellid", "psversiontable", "this", "sender", "event", "eventargs", "eventsubscriber", "foreach", "switch", "stacktrace", "psculture", "psuiculture", "nestedpromptlevel", "psscriptroot", "pscommandpath", "?", "^"]);

const escapes: Record<string, string> = { "0": "\0", a: "\x07", b: "\b", e: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };

export const resolved = (values: string[], maybe_unset = false): Value => {
  const unique = [...new Set(values)];
  return unique.length > max_values ? { unresolved: "more than 8 possible values" } : { values: unique, maybe_unset };
};

export const unresolved = (reason: string): Value => ({ unresolved: reason });

export const create_values = (env: Record<string, string | undefined>, script_path = ""): ValueState => ({
  vars: new Map(),
  env: new Map(),
  base_env: new Map(Object.entries(env).flatMap(([name, value]) => (typeof value === "string" ? [[name.toLowerCase(), value] as const] : []))),
  vars_reason: "",
  env_reason: "",
  script_path,
});

export const copy_values = (state: ValueState): ValueState => ({ ...state, vars: new Map(state.vars), env: new Map(state.env) });

export const join_value = (a: Value, b: Value): Value => {
  if ("unresolved" in a) return a;
  if ("unresolved" in b) return b;
  if (Boolean(a.list) !== Boolean(b.list) && a.values.length && b.values.length) return unresolved("not a string");
  const joined = resolved([...a.values, ...b.values], a.maybe_unset || b.maybe_unset);
  return "unresolved" in joined || !(a.list || b.list) ? joined : { ...joined, list: true };
};

const variable_binding = (state: ValueState, key: string): Value => state.vars.get(key) ?? (state.vars_reason ? unresolved(state.vars_reason) : unset);

const env_binding = (state: ValueState, key: string): Value => {
  const base = state.base_env.get(key);
  return state.env.get(key) ?? (state.env_reason ? unresolved(state.env_reason) : base === undefined ? unset : resolved([base]));
};

export const join_value_states = (a: ValueState, b: ValueState): ValueState => {
  const vars = new Map<string, Value>();
  for (const key of new Set([...a.vars.keys(), ...b.vars.keys()])) vars.set(key, join_value(variable_binding(a, key), variable_binding(b, key)));
  const env = new Map<string, Value>();
  for (const key of new Set([...a.env.keys(), ...b.env.keys()])) env.set(key, join_value(env_binding(a, key), env_binding(b, key)));
  return { ...a, vars, env, vars_reason: a.vars_reason || b.vars_reason, env_reason: a.env_reason || b.env_reason };
};

export const assign_variable = (state: ValueState, name: string, value: Value) => state.vars.set(name.toLowerCase(), value);

export const assign_env = (state: ValueState, name: string, value: Value) => state.env.set(name.toLowerCase(), value);

export const poison_variables = (state: ValueState, reason: string) => {
  state.vars.clear();
  state.vars_reason = reason;
};

export const poison_environment = (state: ValueState, reason: string) => {
  state.env.clear();
  state.env_reason = reason;
};

export const assign_joined = (state: ValueState, name: string, value: Value, env: boolean) => {
  const key = name.toLowerCase();
  (env ? state.env : state.vars).set(key, join_value(env ? env_binding(state, key) : variable_binding(state, key), value));
};

const variable_cmdlets = /^(?:set-variable|sv|new-variable|nv|clear-variable|clv|remove-variable|rv)$/i;

const item_cmdlets = /^(?:set-item|si|new-item|ni|remove-item|ri|rm|rmdir|rd|del|erase|clear-item|cli|rename-item|ren|rni|move-item|mi|mv|move|copy-item|cpi|cp|copy|set-content|sc|add-content|ac|clear-content|clc)$/i;

const variable_parameter = /^-(?:outvariable|ov|errorvariable|ev|warningvariable|wv|informationvariable|iv|pipelinevariable|pv)(?::|$)/i;

export const command_writes = (name: string, args: { word: Word; value: Value }[], text: string, state: ValueState): boolean => {
  const reason = "written by " + (name || "an expression");
  if (/\$executioncontext\b/i.test(text)) {
    poison_variables(state, reason);
    poison_environment(state, reason);
    return true;
  }
  if (/\[ref\]/i.test(text) || args.some((arg) => variable_parameter.test(arg.word.raw))) poison_variables(state, reason);
  if (/\[(?:system\.)?environment\]::setenvironmentvariable/i.test(text)) {
    const literal = /::setenvironmentvariable\s*\(\s*(['"])([\w()]+)\1/i.exec(text);
    if (literal) assign_env(state, literal[2] ?? "", unresolved(reason));
    else poison_environment(state, reason);
  }
  if (variable_cmdlets.test(name)) {
    const named = args.findIndex((arg) => /^-n(?:a(?:m(?:e)?)?)?$/i.test(arg.word.raw));
    const target = named >= 0 ? args[named + 1] : args.find((arg) => !arg.word.raw.startsWith("-"));
    const literal = target && "values" in target.value && target.value.values.length === 1 ? target.value.values[0] : undefined;
    if (literal) assign_variable(state, literal, unresolved(reason));
    else poison_variables(state, reason);
  }
  if (!item_cmdlets.test(name)) return false;
  for (const arg of args) {
    if ("unresolved" in arg.value) {
      if (/\b(?:env|variable):/i.test(arg.word.raw)) {
        poison_variables(state, reason);
        poison_environment(state, reason);
      }
      continue;
    }
    for (const candidate of arg.value.values) {
      const match = /^(env|variable):[\\/]?([^\\/*?]+)$/i.exec(candidate);
      if (match && match[1]?.toLowerCase() === "env") assign_env(state, match[2] ?? "", unresolved(reason));
      else if (match) assign_variable(state, match[2] ?? "", unresolved(reason));
    }
  }
  return false;
};

export const read_env = (state: ValueState, name: string, raw = false): Value => {
  const value = env_binding(state, name.toLowerCase());
  if ("unresolved" in value) return value;
  if (!value.values.length) return unresolved("not set in the environment");
  return !raw && value.values.some((entry) => entry.includes(";")) ? unresolved("holds a list of paths") : value;
};

export const read_variable = (state: ValueState, name: string, raw_env = false): Value => {
  const key = name.toLowerCase();
  if (key.startsWith("env:")) return read_env(state, name.slice(4), raw_env);
  if (key.includes(":")) return unresolved("scoped variable");
  if (key === "null") return unset;
  if (key === "true" || key === "false") return resolved([key === "true" ? "True" : "False"]);
  if ((key === "psscriptroot" || key === "pscommandpath") && state.script_path) {
    return resolved([key === "psscriptroot" ? path.win32.dirname(state.script_path) : state.script_path]);
  }
  if (key === "pwd" && state.pwd) return state.pwd;
  if (automatic.has(key)) return unresolved("automatic variable");
  return state.vars.get(key) ?? unresolved(state.vars_reason || "no assignment in this command");
};

const in_string = (value: Value): Value => {
  if ("unresolved" in value) return value;
  if (value.list) return unresolved("not a string");
  return resolved(value.maybe_unset || !value.values.length ? [...value.values, ""] : value.values);
};

export const concat = (parts: Value[]): Value => {
  let values = [""];
  for (const part of parts) {
    if ("unresolved" in part) return part;
    if (part.list) return unresolved("not a string");
    values = values.flatMap((head) => part.values.map((tail) => head + tail));
    if (new Set(values).size > max_values) return unresolved("more than 8 possible values");
  }
  return resolved(values);
};

const expand = (text: string, bare: boolean, state: ValueState, raw_env: boolean): Value => {
  const parts: Value[] = [];
  let literal = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "`") {
      const next = text[index + 1] ?? "";
      literal += escapes[next] ?? next;
      index += 2;
      continue;
    }
    const match = char === "$" ? reference.exec(text.slice(index)) : null;
    if (!match) {
      literal += char;
      index += 1;
      continue;
    }
    const end = index + match[0].length;
    if (bare && index === 0 && /^(?:\.\w|\[)/.test(text.slice(end, end + 2))) return unresolved("property access");
    if (literal) parts.push(resolved([literal]));
    literal = "";
    parts.push(in_string(read_variable(state, match[1] ?? match[2] ?? "", raw_env)));
    index = end;
  }
  if (literal || !parts.length) parts.push(resolved([literal]));
  return concat(parts);
};

const piece_value = (piece: Piece, state: ValueState, dialect: Dialect, raw_env: boolean): Value => {
  if (piece.kind === "splat") return unresolved("splatted arguments");
  if (piece.kind === "block") return unresolved("script block");
  if (piece.kind === "group") {
    if (dialect !== "powershell") return unresolved("command output");
    if (piece.open === "@{") return unresolved("not a string");
    return piece.open === "@(" ? list_value(piece.text, state, raw_env) : expression_value(piece.text, state, raw_env);
  }
  if (piece.quote === "single" || piece.quote === "single_here") return resolved([piece.text]);
  if (dialect !== "powershell") return /[$`]/.test(piece.text) ? unresolved(dialect === "posix" ? "shell variable" : "unknown shell") : resolved([piece.text]);
  return expand(piece.text, piece.quote === "none", state, raw_env);
};

export const word_value = (word: Word, state: ValueState, dialect: Dialect, raw_env = false): Value => {
  if (word.op) return unresolved("not a string");
  const [first, second] = word.pieces;
  const closed = first && !(first.kind === "text" && first.quote === "none");
  if (closed && second?.kind === "text" && second.quote === "none" && /^[.[]/.test(second.text)) return unresolved("property access");
  if (word.pieces.length > 1 && word.pieces.some((piece) => piece.kind === "group" && piece.open !== "$(")) return unresolved("not a string");
  if (dialect === "powershell" && word.pieces.length === 1 && first?.kind === "text" && (first.quote === "none" || first.quote === "double")) {
    const match = reference.exec(first.text);
    if (match && match[0].length === first.text.length) {
      const value = read_variable(state, match[1] ?? match[2] ?? "", raw_env);
      return first.quote === "double" ? in_string(value) : value;
    }
  }
  if (word.pieces.length === 1 && first) return piece_value(first, state, dialect, raw_env);
  return concat(word.pieces.map((piece) => in_string(piece_value(piece, state, dialect, raw_env))));
};

export const expression_head = (text: string): boolean => /^(?:['"$@([,!+-]|\d|\.\d)/.test(text.trimStart());

const join_path = (args: Word[], state: ValueState, raw_env: boolean): Value => {
  let parent: Value | null = null;
  let child: Value | null = null;
  let slot = "";
  let resolve = false;
  for (const word of args) {
    const piece = word.pieces.length === 1 ? word.pieces[0] : undefined;
    const flag = piece?.kind === "text" && piece.quote === "none" ? /^-(\w+)$/.exec(piece.text) : null;
    const name = (flag?.[1] ?? "").toLowerCase();
    if (flag && name !== "resolve" && name !== "path" && name !== "childpath") return unresolved("expression not evaluated");
    if (flag) {
      resolve ||= name === "resolve";
      slot = name === "resolve" ? slot : name;
      continue;
    }
    const value = word_value(word, state, "powershell", raw_env);
    const as_child = slot === "childpath" || (!slot && parent !== null);
    if (as_child ? child : parent) return unresolved("expression not evaluated");
    if (as_child) child = value;
    else parent = value;
    slot = "";
  }
  if (!parent || !child) return unresolved("expression not evaluated");
  if ("unresolved" in parent) return parent;
  if ("unresolved" in child) return child;
  const trimmed = (value: { values: string[] }, pattern: RegExp): Value => ({ values: value.values.map((entry) => entry.replace(pattern, "")), maybe_unset: false });
  const joined = concat([trimmed(parent, /[\\/]+$/), resolved(["\\"]), trimmed(child, /^[\\/]+/)]);
  return resolve && "values" in joined && joined.values.some((entry) => /[*?[]/.test(entry)) ? unresolved("wildcard") : joined;
};

const rooted = (value: string) => /^(?:[\\/]|[A-Za-z]:)/.test(value);

const combine = (items: Value[]): Value => {
  let values = [""];
  for (const item of items) {
    if ("unresolved" in item) return item;
    if (item.list) return unresolved("not a string");
    values = values.flatMap((head) => item.values.map((tail) => (!head || rooted(tail) ? tail : head.replace(/[\\/]$/, "") + "\\" + tail)));
  }
  return resolved(values);
};

const operand_value = (words: Word[], state: ValueState, raw_env: boolean): Value => {
  const [first, second] = words;
  const head = first?.pieces.length === 1 && first.pieces[0]?.kind === "text" && first.pieces[0].quote === "none" ? first.pieces[0].text : "";
  if (words.length === 2 && second && /^\[(?:system\.)?string\]$/i.test(head)) return in_string(operand_value([second], state, raw_env));
  if (words.length === 2 && second?.glued && second.pieces[0]?.kind === "group" && /^\[(?:system\.)?io\.path\]::combine$/i.test(head)) {
    return combine(group_items(second.pieces[0].text, state, raw_env));
  }
  if (words.length !== 1 || !first) return unresolved("expression not evaluated");
  if (head && !head.startsWith("$")) return unresolved(/^\d/.test(head) ? "not a string" : "expression not evaluated");
  return word_value(first, state, "powershell", raw_env);
};

const operand_sum = (words: Word[], state: ValueState, raw_env: boolean): Value => {
  const operands: Word[][] = [[]];
  for (const word of words) {
    if (word.op === "+") operands.push([]);
    else operands.at(-1)?.push(word);
  }
  const values = operands.map((operand) => operand_value(operand, state, raw_env));
  return values.length === 1 ? (values[0] as Value) : concat(values);
};

const as_list = (items: Value[]): Value => {
  const values: string[] = [];
  for (const item of items) {
    if ("unresolved" in item) return item;
    values.push(...item.values);
  }
  const joined = resolved(values);
  return "unresolved" in joined ? joined : { ...joined, list: true };
};

const expression_words = (words: Word[], state: ValueState, raw_env: boolean): Value => {
  const items: Word[][] = [[]];
  for (const word of words) {
    if (word.op === ",") items.push([]);
    else items.at(-1)?.push(word);
  }
  const values = items.map((item) => operand_sum(item, state, raw_env));
  return values.length === 1 ? (values[0] as Value) : as_list(values);
};

export const group_items = (text: string, state: ValueState, raw_env = false): Value[] => {
  const items: Word[][] = [[]];
  for (const word of shell_words(text, "powershell", "expression")) {
    if (word.op === ",") items.push([]);
    else items.at(-1)?.push(word);
  }
  return items.map((item) => operand_sum(item, state, raw_env));
};

export const expression_value = (text: string, state: ValueState, raw_env = false): Value => {
  const parts = statement_parts(text);
  const element = parts.length === 1 && parts[0]?.elements.length === 1 ? (parts[0].elements[0]?.text ?? "") : "";
  if (!element || assignment_of(element)) return unresolved("command output");
  if (expression_head(element)) return expression_words(shell_words(element, "powershell", "expression"), state, raw_env);
  const [command, ...args] = shell_words(element, "powershell");
  const name = command?.pieces[0]?.kind === "text" ? command.pieces[0].text : "";
  return command?.pieces.length === 1 && /^join-path$/i.test(name) ? join_path(args, state, raw_env) : unresolved("command output");
};

const list_value = (text: string, state: ValueState, raw_env = false): Value => {
  const items: Value[] = [];
  for (const part of statement_parts(text)) {
    const element = part.elements.length === 1 ? (part.elements[0]?.text ?? "") : "";
    if (!element || !expression_head(element)) return unresolved("command output");
    items.push(expression_value(element, state, raw_env));
  }
  return items.length ? as_list(items) : { values: [], maybe_unset: false, list: true };
};

export const assignment_of = (text: string): Assignment | null => {
  let index = 0;
  let cast = "";
  while (text[index] === "[") {
    const end = skip_group(text, index);
    cast = text.slice(index, end);
    index = end;
    while (text[index] === " " || text[index] === "\t") index += 1;
  }
  const names: string[] = [];
  let plain = true;
  while (text[index] === "$") {
    const match = reference.exec(text.slice(index));
    if (!match) return null;
    names.push(match[1] ?? match[2] ?? "");
    index += match[0].length;
    if (text[index] === "." || text[index] === "[") {
      plain = false;
      while (text[index] === "." || text[index] === "[") index = text[index] === "[" ? skip_group(text, index) : index + 1 + (/^\w*/.exec(text.slice(index + 1))?.[0].length ?? 0);
    }
    const comma = /^\s*,\s*/.exec(text.slice(index));
    if (!comma) break;
    plain = false;
    index += comma[0].length;
  }
  if (!names.length) return null;
  const operator = /^\s*(\+\+|--|[-+*/%]?=|\?\?=)(?!=)\s*/.exec(text.slice(index));
  if (!operator || (operator[1] === "++" || operator[1] === "--" ? text.slice(index + operator[0].length).trim() !== "" : false)) return null;
  const rhs_start = index + operator[0].length;
  const scoped = names.some((name) => name.includes(":") && !/^env:/i.test(name));
  const env = names.length === 1 && /^env:/i.test(names[0] ?? "");
  const append = operator[1] === "+=" && names.length === 1;
  const target = !plain || scoped || (operator[1] !== "=" && !append) ? "poison" : env ? "env" : "variable";
  return { target, names, cast, rhs: text.slice(rhs_start), rhs_start, append };
};

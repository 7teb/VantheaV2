import { cmd_word_value, type Search } from "./cmd-batch.ts";
import { copy_location, join_locations, type LocationState, type Matcher } from "./command-location.ts";
import { concat, copy_values, group_items, join_value_states, poison_variables, resolved, unresolved, word_value, type Value, type ValueState } from "./command-values.ts";
import type { Piece, Word } from "./shell-words.ts";
import type { Dialect } from "./statements.ts";

export type WalkState = { values: ValueState; location: LocationState; defined: Set<string>; joined: boolean };

export type StepWord = { word: Word; value: Value; items: Value[] | null };

export type Payload = { dialect: Dialect; value: Value; written: string; walked: boolean };

export type Step = {
  text: string;
  words: StepWord[];
  dialect: Dialect;
  location: Value;
  command: boolean;
  in_process: boolean;
  origin: string;
  line: number;
  depth: number;
  search: Search;
  payload: Payload | null;
  input: Value | null;
  state: WalkState;
};

export type Effect = { kind: "exit"; state: WalkState };

export type Walk = Generator<Step, WalkState, Effect | undefined>;

export type Write = { offset: number; env: boolean; name: string; value: Value };

export type Context = {
  root: string;
  dialect: Dialect;
  origin: string;
  script_path: string;
  depth: number;
  matches: Matcher | undefined;
  initial: WalkState;
  lines: number[];
  fixed: number | null;
  fixed_line: number | null;
  log: { writes: Write[] | null };
  logging: Write[] | null;
  silent: boolean;
  loop_vars: string;
};

export type GroupPiece = Extract<Piece, { kind: "group" }>;

export type BlockPiece = Extract<Piece, { kind: "block" }>;

export const source_depth = 4;

export const keywords = new Set(["if", "elseif", "else", "switch", "foreach", "for", "while", "do", "until", "try", "catch", "finally", "trap", "function", "filter", "workflow", "configuration", "param", "return", "throw", "exit", "break", "continue", "class", "enum", "data", "begin", "process", "end", "dynamicparam", "clean"]);

export const follows: Record<string, RegExp> = { if: /^(?:elseif|else)$/, elseif: /^(?:elseif|else)$/, try: /^(?:catch|finally)$/, catch: /^(?:catch|finally)$/, do: /^(?:while|until)$/ };

const shells: Record<string, Dialect> = { cmd: "cmd", powershell: "powershell", pwsh: "powershell", bash: "posix", sh: "posix" };

const powershell_values = ["executionpolicy", "windowstyle", "inputformat", "outputformat", "configurationname", "version", "psconsolefile", "workingdirectory", "settingsfile", "custompipename", "ep", "wd", "if", "of"];

export const powershell_switch = (raw: string): string => /^[-/\u2013\u2014\u2015](\w+):?$/.exec(raw)?.[1]?.toLowerCase() ?? "";

export const powershell_takes_value = (name: string): boolean => powershell_values.some((value) => value.startsWith(name));

export const copy_state = (state: WalkState): WalkState => ({ values: copy_values(state.values), location: copy_location(state.location), defined: new Set(state.defined), joined: state.joined });

export const join_states = (a: WalkState, b: WalkState): WalkState => ({
  values: join_value_states(a.values, b.values),
  location: join_locations(a.location, b.location),
  defined: new Set([...a.defined, ...b.defined]),
  joined: a.joined || b.joined,
});

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const lost_location = (state: WalkState, statement: string) => {
  state.location = { current: unresolved("working directory unknown after: " + statement.slice(0, 200)), stack: [], stack_known: false };
};

export const drain = (walk: Walk): WalkState => {
  let next = walk.next();
  while (!next.done) next = walk.next(undefined);
  return next.value;
};

export const plain = (word: Word | undefined): string => {
  const piece = word?.pieces.length === 1 ? word.pieces[0] : undefined;
  return piece?.kind === "text" && piece.quote === "none" ? piece.text.toLowerCase() : "";
};

export const keyword_of = (text: string): string => /^(?::[A-Za-z_]\w*[ \t]+)?([A-Za-z]+)(?![\w.:\\/-])/.exec(text)?.[1]?.toLowerCase() ?? "";

export const values_at = (state: WalkState): ValueState => ({ ...state.values, pwd: state.location.current });

export const redirect_free = (args: StepWord[]): StepWord[] =>
  args.filter((arg, index) => {
    const before = args[index - 1]?.word;
    return !arg.word.op && !(before?.op && before.op !== "," && !/&\d$/.test(before.raw));
  });

export const invoked_block = (word: Word | undefined): BlockPiece | null => {
  const [block, call] = word?.pieces ?? [];
  return block?.kind === "block" && word?.pieces.length === 2 && call?.kind === "text" && /^\.invoke(?:returnasis)?\(\s*\)$/i.test(call.text) ? block : null;
};

export const group_at = (words: Word[], index: number): GroupPiece | null => {
  const piece = words[index]?.pieces.length === 1 ? words[index]?.pieces[0] : undefined;
  return piece?.kind === "group" ? piece : null;
};

export const block_at = (words: Word[], index: number): BlockPiece | null => {
  const piece = words[index]?.pieces.length === 1 ? words[index]?.pieces[0] : undefined;
  return piece?.kind === "block" ? piece : null;
};

export const context = (root: string, dialect: Dialect, origin: string, script_path: string, depth: number, matches: Matcher | undefined, initial: WalkState, fixed_line: number | null): Context => {
  const lines: number[] = [];
  for (let index = root.indexOf("\n"); index >= 0; index = root.indexOf("\n", index + 1)) lines.push(index);
  return { root, dialect, origin, script_path, depth, matches, initial: copy_state(initial), lines, fixed: null, fixed_line, log: { writes: null }, logging: null, silent: false, loop_vars: "" };
};

export const line_at = (ctx: Context, offset: number): number => {
  if (ctx.fixed_line !== null) return ctx.fixed_line;
  const at = ctx.fixed ?? offset;
  let low = 0;
  let high = ctx.lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((ctx.lines[middle] ?? 0) < at) low = middle + 1;
    else high = middle;
  }
  return low + 1;
};

export const record = (ctx: Context, offset: number, env: boolean, name: string, value: Value) => {
  ctx.logging?.push({ offset: ctx.fixed ?? offset, env, name, value });
};

export const step_word = (word: Word, state: WalkState, ctx: Context, snapshot: ValueState): StepWord => {
  const piece = word.pieces[0];
  const verbatim = piece?.kind === "text" && piece.quote === "verbatim";
  const value = ctx.dialect === "cmd" || verbatim ? cmd_word_value(word, ctx.dialect === "cmd" ? snapshot : state.values, ctx.script_path, ctx.loop_vars) : word_value(word, values_at(state), ctx.dialect);
  const items = ctx.dialect === "powershell" && piece?.kind === "group" && piece.open === "(" ? group_items(piece.text, values_at(state)) : null;
  return { word, value, items };
};

export const make_step = (text: string, words: StepWord[], state: WalkState, ctx: Context, offset: number, command: boolean, in_process: boolean, search: Search, payload: Payload | null, input: Value | null = null): Step => ({
  text, words, dialect: ctx.dialect, location: state.location.current, command, in_process, origin: ctx.origin, line: line_at(ctx, offset), depth: ctx.depth, search, payload, input, state: copy_state(state),
});

export const program_name = (value: Value, name: string): string => {
  const candidate = "values" in value && value.values.length === 1 ? (value.values[0] ?? "") : name;
  return (candidate.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(?:exe|com)$/, "");
};

export const script_like = (value: Value): boolean => "unresolved" in value || value.values.some((entry) => /\.psm?1$/i.test(entry));

export const merged = (current: WalkState, exit: WalkState, kind: "call" | "dot"): WalkState => {
  if (kind === "dot") return { ...copy_state(exit), values: { ...copy_values(exit.values), script_path: current.values.script_path } };
  const out = copy_state(current);
  out.values.env = new Map(exit.values.env);
  out.values.env_reason = exit.values.env_reason;
  out.location = copy_location(exit.location);
  for (const [key, value] of exit.values.vars) if (!same(value, current.values.vars.get(key))) out.values.vars.set(key, unresolved("changed by a called script"));
  if (exit.values.vars_reason !== current.values.vars_reason) poison_variables(out.values, exit.values.vars_reason);
  return out;
};

const native_argument = (value: Value): Value => ("values" in value ? resolved(value.values.map((entry) => (/\s/.test(entry) && !entry.includes('"') ? `"${entry}"` : entry))) : value);

const cmd_line = (text: string, strip: boolean): string => {
  const last = text.lastIndexOf('"');
  if (!text.startsWith('"') || last === 0) return text;
  const inner = text.slice(1, last);
  const program = inner.split(/\s/)[0] ?? "";
  const kept = !strip && !inner.includes('"') && !/[&<>()@^|]/.test(inner) && /\s/.test(inner) && /[\\/:]/.test(program) && /\.\w{1,4}$/.test(inner);
  return kept ? text : inner + text.slice(last + 1);
};

const block_text = (args: StepWord[] | null): string | null => {
  const piece = args?.length === 1 && args[0]?.word.pieces.length === 1 ? args[0].word.pieces[0] : undefined;
  return piece?.kind === "block" ? piece.text : null;
};

const payload = (dialect: Dialect, args: StepWord[] | null, input: Value | null, ctx: Context, encoded = false, strip = false): Payload => {
  const parts = args?.map((arg) => (dialect === "cmd" ? native_argument(arg.value) : arg.value));
  const block = block_text(args);
  const spaced = parts?.flatMap((part, index) => (index && !args?.[index]?.word.glued ? [resolved([" "]), part] : [part]));
  const joined = block !== null ? resolved([block]) : spaced ? concat(spaced) : (input ?? unresolved("no payload"));
  const value = dialect === "cmd" && "values" in joined ? resolved(joined.values.map((entry) => cmd_line(entry, strip))) : joined;
  const text = encoded && "values" in value ? resolved(value.values.map((entry) => Buffer.from(entry, "base64").toString("utf16le"))) : value;
  return { dialect, value: text, written: args ? args.map((arg) => arg.word.raw).join(" ") : "pipeline input", walked: "values" in text && ctx.depth < source_depth };
};

const cmd_payload = (args: StepWord[], ctx: Context): Payload | null => {
  let strip = false;
  for (const [index, arg] of args.entries()) {
    const raw = arg.word.raw;
    if (raw === "--%" || /^\/(?![ckrs]$)[a-z](?::\w+)?$/i.test(raw)) continue;
    if (/^\/s$/i.test(raw)) {
      strip = true;
      continue;
    }
    if (/^\/[ckr]$/i.test(raw)) return payload("cmd", args.slice(index + 1), null, ctx, false, strip);
    if (/^\/[ckr]/i.test(raw)) {
      const rest = { ...arg, value: "values" in arg.value ? resolved(arg.value.values.map((entry) => entry.slice(2))) : arg.value };
      return payload("cmd", [rest, ...args.slice(index + 1)], null, ctx, false, strip);
    }
    return { dialect: "cmd", value: unresolved("cmd argument is neither a switch nor /c, /k or /r"), written: raw, walked: false };
  }
  return null;
};

export const payload_of = (exe: string, words: StepWord[], at: number, input: Value | null, ctx: Context): Payload | null => {
  const args = words.slice(at + 1).filter((entry, index, all) => !entry.word.op && !all[index - 1]?.word.op);
  if (exe === "iex" || exe === "invoke-expression") {
    const flag = args.findIndex((arg) => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(arg.word.raw));
    const chosen = flag >= 0 ? args.slice(flag + 1, flag + 2) : args.slice(0, 1);
    return chosen.length || input ? payload("powershell", chosen.length ? chosen : null, input, ctx) : null;
  }
  const dialect = shells[exe];
  if (dialect === "cmd") return cmd_payload(args, ctx);
  if (dialect === "posix") {
    const flag = args.findIndex((arg) => arg.word.raw === "-c");
    return flag >= 0 ? payload("posix", args.slice(flag + 1, flag + 2), null, ctx) : null;
  }
  if (dialect !== "powershell") return null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = powershell_switch(args[index]?.word.raw ?? "");
    if (!flag || "file".startsWith(flag)) return null;
    if ("command".startsWith(flag)) return payload("powershell", args.slice(index + 1), null, ctx);
    if (flag === "ec" || "encodedcommand".startsWith(flag)) return payload("powershell", args.slice(index + 1, index + 2), null, ctx, true);
    if (powershell_takes_value(flag)) index += 1;
  }
  return null;
};

export const child_state = (state: WalkState): WalkState => ({
  values: { ...copy_values(state.values), vars: new Map(), vars_reason: "", script_path: "" },
  location: { current: state.location.current, stack: [], stack_known: true },
  defined: new Set(),
  joined: false,
});

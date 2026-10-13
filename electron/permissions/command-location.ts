import path from "node:path";
import { join_value, resolved, unresolved, type Value } from "./command-values.ts";
import type { Word } from "./shell-words.ts";
import type { Dialect } from "./statements.ts";

type Alternative = { current: Value; stack: Value[] };

export type LocationState = { current: Value; stack: Value[]; stack_known: boolean; alternatives?: Alternative[] };

type LocationArg = { word: Word; value: Value };

export type Matcher = (pattern: string) => string[];

const max_locations = 4;

const max_alternatives = 4;

const switch_params = new Set(["passthru", "verbose", "vb", "debug", "db", "whatif", "wi", "confirm", "cf"]);

const value_params = new Set(["erroraction", "ea", "warningaction", "wa", "informationaction", "infa", "errorvariable", "ev", "warningvariable", "wv", "informationvariable", "iv", "outvariable", "ov", "outbuffer", "ob", "pipelinevariable", "pv"]);

const set_names = /^(?:set-location|cd|chdir|sl)$/i;

const push_names = /^(?:push-location|pushd)$/i;

const pop_names = /^(?:pop-location|popd)$/i;

export const start_location = (location: string): LocationState => ({ current: resolved([path.win32.resolve(location)]), stack: [], stack_known: true });

export const copy_location = (state: LocationState): LocationState => ({ ...state, stack: [...state.stack] });

const capped = (value: Value): Value => ("values" in value && value.values.length > max_locations ? unresolved("more than 4 possible working directories") : value);

const alternatives_of = (state: LocationState): Alternative[] | null =>
  state.alternatives ?? (state.stack_known ? [{ current: state.current, stack: state.stack }] : null);

const from_alternatives = (list: Alternative[]): LocationState => {
  const unique = [...new Map(list.map((entry) => [JSON.stringify(entry), entry])).values()];
  const [head, ...rest] = unique as [Alternative, ...Alternative[]];
  const current = capped(rest.reduce((sum, entry) => join_value(sum, entry.current), head.current));
  if (rest.every((entry) => entry.stack.length === head.stack.length)) {
    return { current, stack: head.stack.map((entry, index) => capped(rest.reduce((sum, other) => join_value(sum, other.stack[index] ?? entry), entry))), stack_known: true };
  }
  return unique.length > max_alternatives ? { current, stack: [], stack_known: false } : { current, stack: [], stack_known: false, alternatives: unique };
};

const moved = (state: LocationState, move: (entry: Alternative) => Alternative, unknown: Value): LocationState => {
  const list = alternatives_of(state);
  return list ? from_alternatives(list.map(move)) : { current: unknown, stack: [], stack_known: false };
};

export const join_locations = (a: LocationState, b: LocationState): LocationState => {
  const left = alternatives_of(a);
  const right = alternatives_of(b);
  if (!left || !right) return { current: capped(join_value(a.current, b.current)), stack: [], stack_known: false };
  return from_alternatives([...left, ...right]);
};

const absolute_path = (value: string): boolean => /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(value);

export const against_location = (value: Value, location: Value): Value => {
  if ("unresolved" in value) return value;
  const found: string[] = [];
  for (const candidate of value.values) {
    if (absolute_path(candidate)) {
      found.push(path.win32.resolve(candidate));
      continue;
    }
    if ("unresolved" in location) return location;
    found.push(...location.values.map((base) => path.win32.resolve(base, candidate)));
  }
  return resolved(found, value.maybe_unset);
};

export const start_process_targets = (file: Value, location: Value, working: Value | null): Value => {
  if (!working || "unresolved" in file) return against_location(file, location);
  const folder = against_location(working, location);
  const found: string[] = [];
  for (const candidate of file.values) {
    if (absolute_path(candidate)) {
      found.push(path.win32.resolve(candidate));
      continue;
    }
    if ("unresolved" in folder) return folder;
    if ("unresolved" in location) return location;
    found.push(...location.values.map((base) => path.win32.resolve(base, candidate)), ...folder.values.map((base) => path.win32.resolve(base, candidate)));
  }
  return resolved(found, file.maybe_unset);
};

const flag_of = (word: Word): string | null => {
  const piece = word.pieces.length === 1 ? word.pieces[0] : undefined;
  const match = piece?.kind === "text" && piece.quote === "none" ? /^-([A-Za-z]+):?$/.exec(piece.text) : null;
  return match ? (match[1] ?? "").toLowerCase() : null;
};

const powershell_param = (flag: string): string => {
  if (flag === "lp" || flag === "pspath" || ("literalpath".startsWith(flag) && flag.length >= 2)) return "literalpath";
  if ("path".startsWith(flag) && flag.length >= 3) return "path";
  if ("stackname".startsWith(flag)) return "stackname";
  if ("passthru".startsWith(flag) && flag.length >= 3) return "passthru";
  return switch_params.has(flag) || value_params.has(flag) ? flag : "";
};

type Target = { value: Value; literal: boolean } | { unknown: true } | null;

const powershell_target = (args: LocationArg[]): Target => {
  let found: Target = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as LocationArg;
    const flag = flag_of(arg.word);
    const param = flag === null ? "" : powershell_param(flag);
    if (flag !== null && (!param || param === "stackname")) return { unknown: true };
    if (switch_params.has(param)) continue;
    if (value_params.has(param)) {
      index += 1;
      continue;
    }
    const value_arg = param ? args[index + 1] : arg;
    if (param) index += 1;
    if (!value_arg || found) return { unknown: true };
    found = { value: value_arg.value, literal: param === "literalpath" };
  }
  return found;
};

const target_paths = (target: Value, literal: boolean, location: Value, dialect: Dialect, matches: Matcher | undefined): Value => {
  if ("unresolved" in target) return target;
  const found: string[] = [];
  for (const candidate of target.values) {
    const provider = /^(?:[\w.]+\\)?[\w.]+::/.test(candidate) || /^[A-Za-z]{2,}:/.test(candidate);
    if (!candidate || provider || /^[-+~]$|^~[\\/]/.test(candidate)) return unresolved("unsupported location");
    const full = against_location(resolved([candidate]), location);
    if ("unresolved" in full) return full;
    if (literal || dialect === "cmd" || !/[*?[]/.test(candidate)) {
      found.push(...full.values);
      continue;
    }
    const hits = full.values.flatMap((pattern) => matches?.(pattern) ?? []);
    if (hits.length !== 1) return unresolved("wildcard");
    found.push(...hits);
  }
  return capped(resolved(found));
};

const cmd_target = (args: LocationArg[], location: Value, change_drive: boolean): Value | null => {
  const rest = args.filter((arg) => !/^\/d$/i.test(arg.word.raw));
  if (!rest.length) return null;
  const joined = rest.length === 1 ? (rest[0]?.value as Value) : rest.reduce<Value>((sum, arg, index) => {
    if ("unresolved" in sum) return sum;
    if ("unresolved" in arg.value) return arg.value;
    return resolved(sum.values.flatMap((head) => (arg.value as { values: string[] }).values.map((tail) => (index ? head + " " + tail : tail))));
  }, resolved([""]));
  if ("unresolved" in joined || change_drive || "unresolved" in location) return joined;
  const drives = new Set(location.values.map((entry) => entry.slice(0, 2).toLowerCase()));
  return joined.values.some((entry) => /^[A-Za-z]:/.test(entry) && !drives.has(entry.slice(0, 2).toLowerCase())) ? unresolved("other drive") : joined;
};

export const location_change = (name: string, args: LocationArg[], state: LocationState, dialect: Dialect, statement: string, matches?: Matcher): LocationState | null => {
  const push = push_names.test(name);
  const pop = pop_names.test(name);
  if (!push && !pop && !(dialect === "cmd" ? /^(?:cd|chdir)$/i : set_names).test(name)) return null;
  const lost = (): LocationState => {
    const current = unresolved("working directory unknown after: " + statement.slice(0, 200));
    return push ? { current, stack: [], stack_known: false } : moved(state, (entry) => ({ current, stack: entry.stack }), current);
  };
  if (pop) {
    if (args.some((arg) => flag_of(arg.word) !== "passthru") || !alternatives_of(state)) return lost();
    return moved(state, (entry) => ({ current: entry.stack.at(-1) ?? entry.current, stack: entry.stack.slice(0, -1) }), state.current);
  }
  let target: Value | null;
  let literal = false;
  if (dialect === "cmd") {
    target = cmd_target(args, state.current, push || args.some((arg) => /^\/d$/i.test(arg.word.raw)));
    if (!target) return state;
  } else {
    const found = dialect === "powershell" ? powershell_target(args) : args.length === 1 ? { value: (args[0] as LocationArg).value, literal: true } : { unknown: true as const };
    if (!found && push && dialect === "powershell") return moved(state, (entry) => ({ current: entry.current, stack: [...entry.stack, entry.current] }), state.current);
    if (!found || "unknown" in found) return lost();
    target = found.value;
    literal = found.literal;
  }
  const current = target_paths(target, literal || dialect === "posix", state.current, dialect, matches);
  if (current !== state.current && "unresolved" in current) return lost();
  if (push && dialect === "cmd" && "values" in current && current.values.some((entry) => /^[\\/]{2}/.test(entry))) return lost();
  return moved(state, (entry) => ({ current, stack: push ? [...entry.stack, entry.current] : entry.stack }), current);
};

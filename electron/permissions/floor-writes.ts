import path from "node:path";
import { writes_app } from "./floor-shared.ts";
import { literal, resolve_target, unexplained, uses_app_variable, type Command, type Walk } from "./floor-targets.ts";
import { flag_name, is_flag } from "./powershell-move.ts";
import type { Word } from "./shell-words.ts";

type Destination = { base: Word | null; name: Word | null; ancestors: boolean };

type Arguments = { named: Map<string, Word[]>; positional: Word[][]; switches: Set<string> };

const content_verbs = /^(?:set-content|sc|add-content|ac|out-file|tee-object|tee|set-item|si|new-item|ni)$/;

const folder_verbs = /^(?:mkdir|md)$/;

const copy_verbs = /^(?:copy-item|cpi|cp|copy)$/;

const tree_copy_verbs = /^(?:xcopy|robocopy)$/;

const slash_switch = /^\/[a-z?+-][a-z0-9?+-]*(?::.*)?$/i;

const recursive_switch = /^(?:r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?|s|e|mir)$/;

const path_parameters = ["path", "literalpath", "filepath"];

const valued = [
  "path",
  "literalpath",
  "filepath",
  "destination",
  "name",
  "value",
  "itemtype",
  "encoding",
  "filter",
  "include",
  "exclude",
  "credential",
  "stream",
  "width",
  "inputobject",
  "variable",
  "fromsession",
  "tosession",
  "erroraction",
  "warningaction",
  "informationaction",
  "errorvariable",
  "warningvariable",
  "informationvariable",
  "outvariable",
  "outbuffer",
  "pipelinevariable",
];

const aliases = new Map([
  ["lp", "literalpath"],
  ["pspath", "literalpath"],
  ["type", "itemtype"],
  ["ea", "erroraction"],
  ["wa", "warningaction"],
  ["infa", "informationaction"],
  ["ev", "errorvariable"],
  ["wv", "warningvariable"],
  ["iv", "informationvariable"],
  ["ov", "outvariable"],
  ["ob", "outbuffer"],
  ["pv", "pipelinevariable"],
]);

const tool_name = (verb: string): string => path.win32.basename(verb).toLowerCase().replace(/\.exe$/, "");

const parameter_of = (flag: string): string => {
  const alias = aliases.get(flag);
  if (alias) return alias;
  if (valued.includes(flag)) return flag;
  const matches = valued.filter((name) => name.startsWith(flag));
  return matches.length === 1 ? (matches[0] ?? "") : "";
};

const list_at = (args: Word[], index: number): { words: Word[]; last: number } => {
  const words: Word[] = [];
  let at = index;
  for (let word = args[at]; word && !word.op; word = args[at]) {
    words.push(word);
    if (args[at + 1]?.op !== ",") break;
    at += 2;
  }
  return { words, last: words.length ? at : index - 1 };
};

const parse = (args: Word[]): Arguments => {
  const parsed: Arguments = { named: new Map(), positional: [], switches: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] as Word;
    if (word.op) {
      if (word.op !== "," && !/&\d$/.test(word.raw)) index += 1;
      continue;
    }
    if (slash_switch.test(word.raw)) {
      parsed.switches.add(word.raw.slice(1).toLowerCase());
      continue;
    }
    if (!is_flag(word)) {
      const value = list_at(args, index);
      parsed.positional.push(value.words);
      index = value.last;
      continue;
    }
    const flag = flag_name(word);
    const name = parameter_of(flag);
    if (!name && !word.raw.endsWith(":")) {
      parsed.switches.add(flag);
      continue;
    }
    const value = list_at(args, index + 1);
    parsed.named.set(name || flag, value.words);
    index = Math.max(index, value.last);
  }
  return parsed;
};

const redirect_targets = (words: Word[]): Destination[] =>
  words.flatMap((word, index) => {
    const target = words[index + 1];
    return word.op === ">" && !/&\d$/.test(word.raw) && target && !target.op ? [{ base: target, name: null, ancestors: false }] : [];
  });

const into = (words: Word[] | undefined, ancestors: boolean): Destination[] => (words ?? []).map((base) => ({ base, name: null, ancestors }));

const copy_targets = (parsed: Arguments, named_source: boolean, ancestors: boolean): Destination[] => {
  const destination = parsed.named.get("destination");
  if (destination) return into(destination, ancestors);
  const count = parsed.positional.length;
  if (named_source) return count ? into(parsed.positional[0], ancestors) : [{ base: null, name: null, ancestors }];
  if (count > 1) return into(parsed.positional.at(-1), ancestors);
  return count === 1 ? [{ base: null, name: null, ancestors }] : [];
};

const verb_targets = (command: Command): Destination[] => {
  const verb = command.verb.toLowerCase();
  const tool = tool_name(command.verb);
  if (!content_verbs.test(verb) && !folder_verbs.test(verb) && !copy_verbs.test(verb) && !tree_copy_verbs.test(tool)) return [];
  const parsed = parse(command.args);
  const named_paths = path_parameters.flatMap((name) => parsed.named.get(name) ?? []);
  const recursive = [...parsed.switches, ...parsed.named.keys()].some((flag) => recursive_switch.test(flag));
  if (tree_copy_verbs.test(tool)) {
    const destination = parsed.positional[1];
    return destination ? into(destination, recursive) : parsed.positional.length === 1 ? [{ base: null, name: null, ancestors: recursive }] : [];
  }
  if (copy_verbs.test(verb)) return copy_targets(parsed, named_paths.length > 0, recursive);
  const bases = named_paths.length ? named_paths : folder_verbs.test(verb) ? parsed.positional.flat() : (parsed.positional[0] ?? []);
  const name = parsed.named.get("name")?.[0] ?? null;
  if (!bases.length) return name ? [{ base: null, name, ancestors: false }] : [];
  return bases.map((base) => ({ base, name, ancestors: false }));
};

const hits = (destination: Destination, walk: Walk): boolean => {
  const words = [destination.base, destination.name].filter((word): word is Word => word !== null);
  if (words.some((word) => uses_app_variable(word.raw, walk) || unexplained(word.raw, walk))) return true;
  const base = destination.base ? literal(destination.base) : ".";
  const name = destination.name ? literal(destination.name) : null;
  if (base === null || (destination.name && name === null)) return false;
  return writes_app(resolve_target(name === null ? base : `${base}\\${name}`, walk), walk.scope, destination.ancestors);
};

export const write_verb = (name: string): boolean => {
  const verb = name.toLowerCase();
  return content_verbs.test(verb) || folder_verbs.test(verb) || copy_verbs.test(verb) || tree_copy_verbs.test(tool_name(name));
};

export const writes_into_app = (command: Command, walk: Walk): boolean =>
  [...redirect_targets(command.words), ...verb_targets(command)].some((destination) => hits(destination, walk));

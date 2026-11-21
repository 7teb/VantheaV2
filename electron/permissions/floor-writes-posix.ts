import { head_index, posix_literal } from "./posix-command.ts";
import type { Word } from "./shell-words.ts";

export type PosixDestination = { token: string; ancestors: boolean };

type Spec = { short: string; long: string[] };

type Operands = { operands: (string | null)[]; flags: Set<string>; values: Map<string, string | null> };

const specs = new Map<string, Spec>([
  ["cp", { short: "tS", long: ["target-directory", "suffix"] }],
  ["install", { short: "tSmog", long: ["target-directory", "suffix", "mode", "owner", "group", "strip-program"] }],
  ["touch", { short: "rdt", long: ["reference", "date", "time"] }],
  ["mkdir", { short: "m", long: ["mode"] }],
  ["tee", { short: "", long: [] }],
  ["dd", { short: "", long: [] }],
  ["sed", { short: "efl", long: ["expression", "file", "line-length"] }],
]);

const parse = (args: Word[], spec: Spec): Operands => {
  const parsed: Operands = { operands: [], flags: new Set(), values: new Map() };
  let literal = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] as Word;
    if (word.op) {
      if (!/&\d$/.test(word.raw)) index += 1;
      continue;
    }
    const raw = posix_literal(word);
    if (!literal && raw === "--") {
      literal = true;
      continue;
    }
    if (literal || raw === null || raw === "-" || !raw.startsWith("-")) {
      parsed.operands.push(raw);
      continue;
    }
    if (raw.startsWith("--")) {
      const [name = "", ...glued] = raw.slice(2).split("=");
      parsed.flags.add(name);
      if (glued.length) parsed.values.set(name, glued.join("="));
      else if (spec.long.includes(name)) parsed.values.set(name, posix_literal(args[++index]));
      continue;
    }
    for (let at = 1; at < raw.length; at += 1) {
      const flag = raw.charAt(at);
      parsed.flags.add(flag);
      if (!spec.short.includes(flag)) continue;
      const rest = raw.slice(at + 1);
      parsed.values.set(flag, rest || posix_literal(args[++index]));
      break;
    }
  }
  return parsed;
};

const target_directory = (parsed: Operands): (string | null)[] | null => {
  if (parsed.values.has("t")) return [parsed.values.get("t") ?? null];
  if (parsed.values.has("target-directory")) return [parsed.values.get("target-directory") ?? null];
  return null;
};

const last_operand = (parsed: Operands): (string | null)[] => (parsed.operands.length > 1 ? parsed.operands.slice(-1) : []);

const verb_targets = (verb: string, parsed: Operands): (string | null)[] => {
  if (verb === "cp") return target_directory(parsed) ?? last_operand(parsed);
  if (verb === "install") return parsed.flags.has("d") || parsed.flags.has("directory") ? parsed.operands : (target_directory(parsed) ?? last_operand(parsed));
  if (verb === "dd") return parsed.operands.flatMap((operand) => (operand?.startsWith("of=") ? [operand.slice(3)] : []));
  if (verb !== "sed") return parsed.operands;
  if (!parsed.flags.has("i") && !parsed.flags.has("in-place")) return [];
  const scripted = ["e", "f", "expression", "file"].some((flag) => parsed.values.has(flag));
  return scripted ? parsed.operands : parsed.operands.slice(1);
};

const recursive = (verb: string, parsed: Operands): boolean =>
  verb === "cp" && ["r", "R", "a", "recursive", "archive"].some((flag) => parsed.flags.has(flag));

export const posix_destinations = (words: Word[]): PosixDestination[] => {
  const redirects = words.flatMap((word, index) => (word.op === ">" && !/&\d$/.test(word.raw) ? [posix_literal(words[index + 1])] : []));
  const { verb, at } = head_index(words);
  const spec = specs.get(verb);
  const parsed = spec ? parse(words.slice(at + 1), spec) : null;
  const targets = parsed ? verb_targets(verb, parsed) : [];
  const ancestors = parsed ? recursive(verb, parsed) : false;
  return [
    ...redirects.flatMap((token) => (token === null ? [] : [{ token, ancestors: false }])),
    ...targets.flatMap((token) => (token === null ? [] : [{ token, ancestors }])),
  ];
};

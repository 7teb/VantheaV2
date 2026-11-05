import type { Word } from "./shell-words.ts";

export const is_flag = (word: Word) => /^[-\u2013\u2014\u2015]/.test(word.raw) || /^\/[a-z?](?::\S*)?$/i.test(word.raw);

export const move_sources = (args: Word[]): Word[] => {
  const named: Word[] = [];
  const positional: Word[] = [];
  let destination = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] as Word;
    if (word.op) continue;
    const flag = /^[-\u2013\u2014\u2015](\w+):?$/.exec(word.raw)?.[1]?.toLowerCase() ?? "";
    if (flag && ("path".startsWith(flag) || "literalpath".startsWith(flag) || flag === "lp" || flag === "pspath")) {
      const value = args[++index];
      if (value) {
        named.push(value);
      }
      continue;
    }
    if (flag && ("destination".startsWith(flag) || "newname".startsWith(flag))) {
      destination = true;
      index += 1;
      continue;
    }
    if (flag && /^(?:filter|include|exclude|credential|erroraction|ea|warningaction|wa|informationaction|infa|errorvariable|ev|outvariable|ov|outbuffer|ob|pipelinevariable|pv)$/.test(flag)) {
      index += 1;
      continue;
    }
    if (!is_flag(word)) {
      positional.push(word);
    }
  }
  if (named.length) return named;
  return destination || positional.length < 2 ? positional : positional.slice(0, -1);
};

import type { Word } from "./shell-words.ts";

export const posix_literal = (word: Word | undefined): string | null => {
  if (!word || word.op) return null;
  let text = "";
  for (const piece of word.pieces) {
    if (piece.kind !== "text") return null;
    text += piece.text;
  }
  return text;
};

export const basename = (value: string): string => (value.split(/[\\/]/).pop() ?? value).replace(/\.exe$/i, "").toLowerCase();

export const is_flag = (word: Word): boolean => /^-/.test(word.raw);

const wrappers = new Set(["if", "then", "else", "elif", "do", "while", "until", "time", "!", "sudo", "env", "command", "exec", "nohup", "nice", "builtin", "export", "declare", "local", "readonly", "typeset", "{", "(", "timeout", "flock", "ionice", "stdbuf", "chrt", "taskset", "doas"]);

const positional_wrappers = new Set(["timeout", "flock", "chrt", "taskset"]);

const operand_flags: Record<string, string[]> = {
  nice: ["-n", "--adjustment"],
  exec: ["-a"],
  env: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  ionice: ["-c", "-n", "--class", "--classdata"],
  flock: ["-w", "-E", "--wait", "--timeout", "--conflict-exit-code"],
  stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
  sudo: ["-u", "-g", "-D", "--user", "--group", "--chdir"],
  doas: ["-u", "-C"],
};

const skip_wrapper_args = (words: Word[], from: number, name: string): number => {
  const operands = operand_flags[name] ?? [];
  let index = from;
  while (index < words.length && is_flag(words[index] as Word)) {
    const raw = (words[index] as Word).raw;
    index += operands.includes(raw) ? 2 : 1;
    if (raw === "--") break;
  }
  return positional_wrappers.has(name) && index < words.length ? index + 1 : index;
};

export const bash_builtins = new Set(
  "! [ [[ ]] { } . : alias bg bind break builtin caller case cd command compgen complete compopt continue declare dirs disown do done echo elif else enable esac eval exec exit export false fc fg fi for function getopts hash help history if in jobs kill let local logout mapfile popd printf pushd pwd read readarray readonly return select set shift shopt source suspend test then time times trap true type typeset ulimit umask unalias unset until wait while".split(" "),
);

export const head_index = (words: Word[]): { verb: string; at: number } => {
  let index = 0;
  while (index < words.length) {
    const word = words[index] as Word;
    if (/^[A-Za-z_]\w*=/.test(word.raw)) {
      index += 1;
      continue;
    }
    const value = posix_literal(word);
    if (value === null) return { verb: "", at: index };
    const name = basename(value);
    if (wrappers.has(name)) {
      index = skip_wrapper_args(words, index + 1, name);
      continue;
    }
    return { verb: name, at: index };
  }
  return { verb: "", at: words.length };
};

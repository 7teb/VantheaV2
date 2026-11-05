import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const bash = "C:/Program Files/Git/bin/bash.exe";

const run = (command: string) => {
  const child = spawnSync(bash, ["--noprofile", "--norc", "-c", command], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(child.status, 0, `${command}\n${child.stderr}`);
  assert.equal(child.stderr, "", command);
  assert.ok(child.stdout.endsWith("AFTER"), command);
};

test("the reported here-string and parameter forms execute a harmless following Bash command", { skip: !fs.existsSync(bash) }, () => {
  const commands = [
    "cat <<<word; printf AFTER",
    "cat <<<'literal;value'; printf AFTER",
    'cat <<<"${missing:-"}"}"; printf AFTER',
    'printf "%s" ${missing:-"}"}; printf AFTER',
    "printf '%s' ${missing:-'}'}; printf AFTER",
    'printf "%s" ${missing:-${other:-"}"}}; printf AFTER',
    "printf '%s' ${missing:-$(printf '}')}; printf AFTER",
    "printf '%s' ${missing:-$'}'}; printf AFTER",
    'printf "%s" "${missing:-"}"}"; printf AFTER',
    'printf "%s" "${missing:-\'}\'}"; printf AFTER',
    "printf '%s' ${missing:-a\\}b}; printf AFTER",
    'printf "%s" ${missing#"}"}; printf AFTER',
    "printf '%s' ${missing:-{}; printf AFTER",
    'printf "%s" "${missing:-${other:-"}"}}"; printf AFTER',
  ];
  for (const command of commands) run(command);
});

test("complete quoted and punctuated Bash heredoc delimiters end at their exact word", { skip: !fs.existsSync(bash) }, () => {
  const delimiters = [
    ["END-1", "END-1"], ["END:1", "END:1"], ["1END", "1END"], ["'END-1'", "END-1"], ['"END-1"', "END-1"],
    ['E"ND"-1', "END-1"], ["E'ND'-1", "END-1"], ["\\END-1", "END-1"], ["END\\-1", "END-1"], ['"END 1"', "END 1"],
    ["EO\\ F", "EO F"], ["$'END\\x2d1'", "END-1"], ['$"END-1"', "END-1"], ['E$"ND-1"', "END-1"],
    ["EO\\\nF", "EOF"], ["''", ""], ["$TAG", "$TAG"], ["$(printf 'END')", "$(printf 'END')"], ["${TAG:-'END'}", "${TAG:-'END'}"],
  ];
  for (const [word, tag] of delimiters) run(`cat <<${word}\nbody\n${tag}\nprintf AFTER`);
  run("cat <<FIRST <<'END-2'\none\nFIRST\ntwo\nEND-2\nprintf AFTER");
  run("cat <<-END-1\n\tbody\n\tEND-1\nprintf AFTER");
  run("cat <<'RUN-1' | bash\nprintf BODY\nRUN-1\nprintf AFTER");
  run("cat <<'RUN-1' |& bash\nprintf BODY\nRUN-1\nprintf AFTER");
  run("cat <<<'printf BODY' | bash; printf AFTER");
  run("cat <<'DATA' | bash -c 'cat'\nplain\nDATA\nprintf AFTER");
  run("cat <<'DATA'; bash -c 'printf BASH'\nliteral\nDATA\nprintf AFTER");
});

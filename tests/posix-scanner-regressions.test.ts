import assert from "node:assert/strict";
import { test } from "node:test";
import { floor_reason } from "../electron/permissions/floor.ts";
import { split_statements_posix, split_pipelines_posix, statement_parts_posix, posix_script } from "../electron/permissions/statements-posix.ts";

const tail = "rm -rf /c/Windows";
const scope = { app_root: "C:\\Users\\user\\AppData\\Roaming\\VantheaX", project_root: "D:\\project", cwd: "D:\\project" };

const visible_tail = (source: string) => {
  assert.ok(split_statements_posix(source).includes(tail), source);
  assert.ok(posix_script(source).pipelines.some((pipeline) => pipeline.stages.some((stage) => stage.text === tail)), source);
  const element = statement_parts_posix(source).flatMap((part) => part.elements).find((entry) => entry.text === tail);
  assert.ok(element, source);
  assert.equal(source.slice(element.start, element.start + element.text.length), tail);
  assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
};

test("a here-string word does not consume an adjacent command separator", () => {
  visible_tail(`cat <<<word; ${tail}`);
});

test("a quoted closing brace inside parameter expansion cannot hide the following command", () => {
  visible_tail('printf "%s" ${missing:-"}"}; ' + tail);
});

test("a punctuated heredoc delimiter is consumed in full before scanning later commands", () => {
  visible_tail(`cat <<END-1\nbody\nEND-1\n${tail}`);
});

test("here-string operands stop at every adjacent control operator and preserve quoted operators", () => {
  for (const separator of [";", "&&", "||", "|", "|&", "&", "\n", "\r\n"]) {
    for (const word of ["word", "'a;b|c'", '"a;b|c"', "a\\;b", "$(printf data)", '${missing:-"}"}', '"${missing:-"}"}"']) visible_tail(`cat <<<${word}${separator}${tail}`);
  }
  assert.deepEqual(split_statements_posix("cat <<<'data;literal'"), ["cat <<<'data;literal'"]);
  assert.deepEqual(split_pipelines_posix("cat <<<word|wc -c;pwd"), ["cat <<<word|wc -c", "pwd"]);
});

test("nested parameter expansions and quoted braces preserve later statements and offsets", () => {
  const parameters = ['${missing:-"}"}', "${missing:-'}'}", '${missing:-${other:-"}"}}', "${missing:-$(printf '}')}", "${missing:-$'}'}", '"${missing:-"}"}"', '${missing:-a\\}b}', '${missing#"}"}', '${missing:-{}', '"${missing:-${other:-"}"}}"'];
  for (const expression of parameters) visible_tail(`printf '%s' ${expression}; ${tail}`);
  visible_tail('printf "%s" "${missing:-\'}\'}"; ' + tail);
  const nested = `printf '%s' $(printf '%s' \${missing:-"}"}); ${tail}`;
  visible_tail(nested);
});

test("complete heredoc words preserve later commands and quoted bodies remain data", () => {
  const delimiters = [
    { word: "END-1", tag: "END-1", expands: true },
    { word: "END:1", tag: "END:1", expands: true },
    { word: "1END", tag: "1END", expands: true },
    { word: "'END-1'", tag: "END-1", expands: false },
    { word: '"END-1"', tag: "END-1", expands: false },
    { word: 'E"ND"-1', tag: "END-1", expands: false },
    { word: "E'ND'-1", tag: "END-1", expands: false },
    { word: "\\END-1", tag: "END-1", expands: false },
    { word: "END\\-1", tag: "END-1", expands: false },
    { word: '"END 1"', tag: "END 1", expands: false },
    { word: "EO\\ F", tag: "EO F", expands: false },
    { word: "$'END\\x2d1'", tag: "END-1", expands: false },
    { word: '$"END-1"', tag: "END-1", expands: false },
    { word: 'E$"ND-1"', tag: "END-1", expands: false },
    { word: "EO\\\nF", tag: "EOF", expands: true },
    { word: "''", tag: "", expands: false },
    { word: "$TAG", tag: "$TAG", expands: true },
    { word: "$(printf 'END')", tag: "$(printf 'END')", expands: true },
    { word: "${TAG:-'END'}", tag: "${TAG:-'END'}", expands: true },
  ];
  for (const entry of delimiters) {
    visible_tail(`cat <<${entry.word}\nbody\n${entry.tag}\n${tail}`);
    const source = `cat <<${entry.word}\n$(${tail})\n${entry.tag}\npwd`;
    if (entry.expands) assert.match(floor_reason(source, scope, "posix"), /Windows \/ System32/, source);
    else assert.equal(floor_reason(source, scope, "posix"), "", source);
    assert.ok(!split_statements_posix(`cat <<${entry.word}\n${tail}\n${entry.tag}\npwd`).includes(tail), entry.word);
  }
});

test("heredoc queues belong to their original commands and support tabs, CRLF and empty delimiters", () => {
  visible_tail(`cat <<FIRST <<'END-2'\none\nFIRST\ntwo\nEND-2\n${tail}`);
  visible_tail(`cat <<-END-1\r\n\tbody\r\n\tEND-1\r\n${tail}`);
  assert.match(floor_reason(`bash <<'RUN-1'; cat <<'DATA-2'\n${tail}\nRUN-1\nliteral\nDATA-2`, scope, "posix"), /Windows \/ System32/);
  assert.match(floor_reason(`<<'RUN-1' bash\n${tail}\nRUN-1`, scope, "posix"), /Windows \/ System32/);
  assert.match(floor_reason(`<<<'${tail}' bash`, scope, "posix"), /Windows \/ System32/);
  assert.equal(floor_reason(`cat <<'END-1'\n${tail}\nEND-1`, scope, "posix"), "");
});

test("literal stdin bodies stay attached through every pipeline stage until the true command boundary", () => {
  for (const operator of ["|", "|&"]) for (const shell of ["bash", "sh", "dash"]) {
    assert.match(floor_reason(`cat <<'RUN-1' ${operator} ${shell}\n${tail}\nRUN-1`, scope, "posix"), /Windows \/ System32/);
    assert.match(floor_reason(`cat <<<'${tail}' ${operator} ${shell}`, scope, "posix"), /Windows \/ System32/);
    assert.match(floor_reason(`cat <<'RUN-1' ${operator} cat | ${shell} -s\n${tail}\nRUN-1`, scope, "posix"), /Windows \/ System32/);
  }
  for (const end of ["; bash", "| bash -c 'printf ok'", "| bash -lc 'printf ok'", "| bash -cl 'printf ok'"]) {
    assert.equal(floor_reason(`cat <<'DATA' ${end}\n${tail}\nDATA`, scope, "posix"), "", end);
  }
  assert.equal(floor_reason(`cat <<<'${tail}' | bash -c 'printf ok'`, scope, "posix"), "");
});

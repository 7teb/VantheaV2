import assert from "node:assert/strict";
import { test } from "node:test";
import { shell_words, type Word } from "../electron/permissions/shell-words.ts";

const shape = (word: Word): string =>
  word.op ||
  word.pieces
    .map((piece) => {
      if (piece.kind === "text") return piece.quote + ":" + piece.text;
      if (piece.kind === "splat") return "splat:" + piece.name;
      return (piece.kind === "group" ? piece.open : "{") + piece.text;
    })
    .join("+");

const shapes = (text: string, dialect: "powershell" | "cmd" | "posix" = "powershell", mode: "argument" | "expression" = "argument") =>
  shell_words(text, dialect, mode).map(shape);

test("quote kinds stay apart and a bare word continues through glued quotes", () => {
  assert.deepEqual(shapes(`a 'b c' "d $e" '' x'y'z 'it''s'`), ["none:a", "single:b c", "double:d $e", "single:", "none:x+single:y+none:z", "single:it's"]);
  assert.deepEqual(shapes("${x}b ${env:TEMP}\\y"), ["none:${x}b", "none:${env:TEMP}\\y"]);
});

test("a word that starts with a quote ends at the closing quote unless a member follows", () => {
  const words = shell_words(`'a'b "x".Length`, "powershell");
  assert.deepEqual(words.map(shape), ["single:a", "none:b", "double:x+none:.Length"]);
  assert.deepEqual(words.map((word) => word.glued), [false, true, false]);
});

test("here-strings keep apostrophes, quotes and line breaks as one word", () => {
  assert.deepEqual(shapes("$s = @'\nit's \"here\"; a | b\n'@"), ["none:$s", "none:=", "single_here:it's \"here\"; a | b"]);
  assert.deepEqual(shapes('@"\nline $x\n$(Get-Date) "q"\n"@ next'), ['double_here:line $x\n+$(Get-Date+double_here: "q"', "none:next"]);
});

test("groups, subexpressions, arrays, hashtables and blocks are words with their inner text", () => {
  assert.deepEqual(shapes(`& (Join-Path $a 'b') $(Get-Date) @('x','y') @{k=1} { body }`), ["none:&", "(Join-Path $a 'b'", "$(Get-Date", "@('x','y'", "@{k=1", "{ body "]);
  assert.deepEqual(shapes(`"pre$(x)post" .\\$(y).exe`), ["double:pre+$(x+double:post", "none:.\\+$(y+none:.exe"]);
  const [, group] = shell_words(`Test-Path(.\\a.exe)`, "powershell");
  assert.equal(group?.glued, true);
  assert.equal(group?.pieces[0]?.kind === "group" ? `(${group.pieces[0].text})` : "", "(.\\a.exe)");
});

test("group and block words carry the offset of their inner text", () => {
  const text = `x { a } "$(b)"`;
  const [, block, quoted] = shell_words(text, "powershell");
  const inner = block?.pieces[0];
  const sub = quoted?.pieces[0];
  assert.equal(inner?.kind === "block" ? text.slice(inner.start, inner.start + inner.text.length) : "", " a ");
  assert.equal(sub?.kind === "group" ? text.slice(sub.start, sub.start + sub.text.length) : "", "b");
});

test("an unquoted @name is a splat and a quoted '@x.rsp' is a string", () => {
  assert.deepEqual(shapes(`cl.exe '@build.rsp' @args "@more.rsp"`), ["none:cl.exe", "single:@build.rsp", "splat:args", "double:@more.rsp"]);
});

test("--% passes the rest of the statement verbatim", () => {
  assert.deepEqual(shapes(`icacls x --% /grant %USERNAME%:F "$a"`), ["none:icacls", "none:x", "none:--%", "verbatim:/grant", "verbatim:%USERNAME%:F", 'verbatim:"$a"']);
});

test("redirections are operator words and comments end the words", () => {
  assert.deepEqual(shapes("a 2>&1 > out.txt"), ["none:a", ">", ">", "none:out.txt"]);
  assert.deepEqual(shapes("a#b # c d"), ["none:a#b"]);
  assert.deepEqual(shapes("a <# x #> b"), ["none:a", "none:b"]);
  assert.deepEqual(shapes("a `\n  -Flag"), ["none:a", "none:-Flag"]);
});

test("expression mode splits + and , between strings and stops a variable at its name", () => {
  assert.deepEqual(shapes(`'Remove'+'-Item', $x+"y"`, "powershell", "expression"), ["single:Remove", "+", "single:-Item", ",", "none:$x", "+", "double:y"]);
  assert.deepEqual(shapes(`[IO.Path]::Combine('C:\\a', '\\b')`, "powershell", "expression"), ["none:[IO.Path]::Combine", "(" + `'C:\\a', '\\b'`]);
  assert.deepEqual(shapes(`[string]$x $y.Name`, "powershell", "expression"), ["none:[string]", "none:$x", "none:$y.Name"]);
});

test("cmd words use double quotes and caret escapes only", () => {
  assert.deepEqual(shapes(`echo it's ^& "a b" ^"c (call x.bat) 2>nul`, "cmd"), ["none:echo", "none:it's", "none:&", "double:a b", 'none:"c', "(call x.bat", ">", "none:nul"]);
});

test("posix words unescape backslashes and keep command substitution as a group", () => {
  assert.deepEqual(shapes(`./run.sh "$HOME/x\\"y" 'a b' a\\ b $(pwd)`, "posix"), ["none:./run.sh", 'double:$HOME/x"y', "single:a b", "none:a b", "$(pwd"]);
});

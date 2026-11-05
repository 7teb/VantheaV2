import assert from "node:assert/strict";
import { test } from "node:test";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { output_collector } from "../electron/shell/output.ts";

const marker = /\n\[output over the 25000-token cap per tool result: (\d+) characters omitted here\. Redirect the output to a file and read that file, or filter the output, to see them\.\]\n/;

const numbered = (count: number) => Array.from({ length: count }, (_, index) => `line ${String(index).padStart(6, "0")}\n`).join("");

test("output under the cap comes back whole, with ANSI codes and overwritten progress removed", () => {
  const output = output_collector();
  output.append("start\n\u001b[32mgreen\u001b[0m\n");
  output.append("10%\r50%\r100%\ndone");
  assert.equal(output.text(result_cap_tokens), "start\ngreen\n100%\ndone");
  assert.equal(output.lines(), 3);
  const crlf = output_collector();
  crlf.append("a\rb\r");
  crlf.append("\nc\r");
  assert.equal(crlf.text(result_cap_tokens), "b\r\n");
  assert.equal(output.chars(), "start\ngreen\n100%\ndone".length);
});

test("escape sequences and CRLF split across chunks are cleaned as if they had arrived whole", () => {
  const output = output_collector();
  for (const chunk of ["a\u001b", "[3", "2mb\u001b]8;;http://x\u001b", "\\link\u001b]8;;\u0007\r", "\nnext\r", "\n"]) output.append(chunk);
  assert.equal(output.text(result_cap_tokens), "a" + "b" + "link\r\nnext\r\n");
});

test("colored output over the cap fills the token budget with cleaned text and counts omitted characters after cleaning", () => {
  const output = output_collector();
  const line = "\u001b[32mok\u001b[0m line\n";
  for (let index = 0; index < 30_000; index += 1) output.append(line);
  const text = output.text(result_cap_tokens);
  assert.ok(!text.includes("\u001b"));
  assert.ok(estimate_tokens(text) >= result_cap_tokens - 10, String(estimate_tokens(text)));
  const found = text.match(marker);
  assert.ok(found);
  assert.equal(output.chars(), "ok line\n".length * 30_000);
  assert.equal(Number(found[1]) + text.length - found[0].length, output.chars());
});

test("progress redraws without newlines never push the real start of the output out of the head", () => {
  const output = output_collector();
  output.append("Collecting packages\n");
  for (let percent = 0; percent < 200_000; percent += 1) output.append(`\rDownloading ${percent % 100}%`);
  output.append("\rDownloaded\nDone\n");
  assert.equal(output.text(result_cap_tokens), "Collecting packages\nDownloaded\nDone\n");
  const pieces = output.pieces();
  assert.equal(pieces.head.length + pieces.tail.length, "Collecting packages\nDownloaded\nDone\n".length);
});

test("a line longer than the tail buffer without any newline stays bounded in memory", () => {
  const output = output_collector();
  for (let index = 0; index < 50; index += 1) output.append("z".repeat(10_000));
  const pieces = output.pieces();
  assert.ok(pieces.head.length + pieces.tail.length <= result_cap_tokens * 4);
  assert.equal(pieces.chars, 500_000);
});

test("ASCII output over the cap fills the whole budget, keeps head and tail at about 1:3 and counts what it left out", () => {
  const output = output_collector();
  const full = numbered(40_000);
  for (let at = 0; at < full.length; at += 4096) output.append(full.slice(at, at + 4096));
  const text = output.text(result_cap_tokens);
  assert.ok(estimate_tokens(text) <= result_cap_tokens);
  assert.ok(estimate_tokens(text) >= result_cap_tokens - 10);
  const found = text.match(marker);
  assert.ok(found);
  const [head, tail] = text.split(found[0]);
  assert.ok(full.startsWith(head ?? "_"));
  assert.ok(full.endsWith(tail ?? "_"));
  assert.equal(Number(found[1]), full.length - (head?.length ?? 0) - (tail?.length ?? 0));
  const ratio = (tail?.length ?? 0) / (head?.length ?? 1);
  assert.ok(ratio > 2.9 && ratio < 3.1, String(ratio));
});

test("non-ASCII output is cut by the token estimate, so the result never exceeds the cap", () => {
  const wide = output_collector();
  wide.append("日本語の出力行です。\n".repeat(20_000));
  const text = wide.text(result_cap_tokens);
  assert.ok(estimate_tokens(text) <= result_cap_tokens);
  assert.match(text, marker);
  const inside = output_collector();
  inside.append("ü".repeat(60_000));
  const fitted = inside.text(result_cap_tokens);
  assert.ok(estimate_tokens(fitted) <= result_cap_tokens);
  const found = fitted.match(marker);
  assert.ok(found);
  assert.equal(Number(found[1]) + fitted.length - found[0].length, 60_000);
  const emoji = output_collector();
  emoji.append("😀".repeat(40_000));
  const pairs = emoji.text(1000).split(marker);
  assert.ok(!/[\ud800-\udbff]$/.test(pairs[0] ?? "") && !/^[\udc00-\udfff]/.test(pairs.at(-1) ?? ""));
});

test("a smaller budget leaves room for text around the output", () => {
  const output = output_collector();
  output.append("x".repeat(500_000));
  const lead = `exit code 0 after 1.0 s\n${"n".repeat(4000)}\n`;
  const text = `${lead}${output.text(result_cap_tokens - estimate_tokens(lead))}`;
  assert.ok(estimate_tokens(text) <= result_cap_tokens);
  assert.match(text, marker);
});

test("memory stays bounded to head and tail, and the pieces restore the same text", () => {
  const output = output_collector();
  for (let index = 0; index < 400; index += 1) output.append(`${index}:${"y".repeat(9_990)}\n`);
  const pieces = output.pieces();
  assert.equal(pieces.head.length, result_cap_tokens);
  assert.equal(pieces.tail.length, result_cap_tokens * 3);
  assert.equal(pieces.chars, output.chars());
  assert.equal(output_collector(pieces).text(result_cap_tokens), output.text(result_cap_tokens));
  assert.equal(output_collector({ head: "legacy tail", tail: "", chars: 11 }).text(result_cap_tokens), "legacy tail");
});

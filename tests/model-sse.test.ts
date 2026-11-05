import assert from "node:assert/strict";
import { test } from "node:test";
import { create_sse_parser, type SseItem } from "../electron/model/sse.ts";

const parse_all = (chunks: string[]): SseItem[] => {
  const parser = create_sse_parser();
  return [...chunks.flatMap((chunk) => parser.feed(chunk)), ...parser.end()];
};

test("data lines are dispatched on a blank line", () => {
  assert.deepEqual(parse_all(['data: {"a":1}\n\n', "data: [DONE]\n\n"]), [
    { kind: "event", event: "message", data: '{"a":1}' },
    { kind: "event", event: "message", data: "[DONE]" },
  ]);
});

test("multi-line data joins with a newline and the event field is kept", () => {
  assert.deepEqual(parse_all(["event: update\ndata: first\ndata:second\ndata\n\n"]), [
    { kind: "event", event: "update", data: "first\nsecond\n" },
  ]);
});

test("comment lines are reported as keep-alive items", () => {
  assert.deepEqual(parse_all([": OPENROUTER PROCESSING\n\n", "data: x\n\n"]), [
    { kind: "comment", text: "OPENROUTER PROCESSING" },
    { kind: "event", event: "message", data: "x" },
  ]);
});

test("CRLF, lone CR and LF all end lines", () => {
  const expected: SseItem[] = [
    { kind: "event", event: "message", data: "a" },
    { kind: "event", event: "message", data: "b" },
    { kind: "event", event: "message", data: "c" },
  ];
  assert.deepEqual(parse_all(["data: a\r\n\r\ndata: b\r\rdata: c\n\n"]), expected);
});

test("a CRLF split across chunks is one line ending", () => {
  assert.deepEqual(parse_all(["data: a\r", "\n\r", "\n"]), [{ kind: "event", event: "message", data: "a" }]);
});

test("only one leading space is stripped from a value", () => {
  assert.deepEqual(parse_all(["data:  two spaces\n\n"]), [{ kind: "event", event: "message", data: " two spaces" }]);
});

test("an event without its closing blank line is discarded at the end", () => {
  assert.deepEqual(parse_all(["data: complete\n\n", "data: cut"]), [{ kind: "event", event: "message", data: "complete" }]);
  assert.deepEqual(parse_all(["data: cut\n"]), []);
});

test("id, retry and unknown fields do not produce events", () => {
  assert.deepEqual(parse_all(["id: 7\nretry: 100\nfoo: bar\n\n"]), []);
});

test("arbitrary chunk boundaries give the same result as one feed", () => {
  const stream = ': ping\r\ndata: {"choices":[{"delta":{"content":"hi\\nthere"}}]}\r\n\r\ndata: one\ndata: two\n\n: keep\n\ndata: [DONE]\n\n';
  const whole = parse_all([stream]);
  assert.deepEqual(parse_all([...stream]), whole);
  for (let cut = 0; cut <= stream.length; cut += 1) {
    assert.deepEqual(parse_all([stream.slice(0, cut), stream.slice(cut)]), whole, `cut at ${cut}`);
  }
});

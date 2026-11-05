import assert from "node:assert/strict";
import { test } from "node:test";
import { create_accumulator } from "../electron/model/accumulator.ts";
import { create_draft_decoder, type DraftSource } from "../electron/model/draft-decoder.ts";
import { load_recording, recorded_chunks, recording_names } from "./fixtures/live-code/recordings.ts";

type Decoded = { text: string; deltas: string[]; path: string | null; old_text: string | null; lines: number; path_at: number; old_at: number };

const drain = (source: DraftSource, into: Decoded, step: number) => {
  const take = source.take();
  if (take.delta) {
    into.deltas.push(take.delta);
    into.text += take.delta;
  }
  if (take.path !== null) {
    assert.equal(into.path, null, "path is reported once");
    into.path = take.path;
    into.path_at = step;
  }
  if (take.old_text !== null) {
    assert.equal(into.old_text, null, "old_text is reported once");
    into.old_text = take.old_text;
    into.old_at = step;
  }
  into.lines = take.lines;
  assert.equal(source.pending(), false, "nothing is pending right after a take, except a held surrogate half");
};

const decode = (name: string, chunks: string[]): Decoded => {
  const decoder = create_draft_decoder(name);
  assert.ok(decoder);
  const out: Decoded = { text: "", deltas: [], path: null, old_text: null, lines: 0, path_at: -1, old_at: -1 };
  chunks.forEach((chunk, step) => {
    decoder.feed(chunk);
    drain(decoder, out, step);
  });
  return out;
};

const line_count = (text: string) => (text ? text.split("\n").length : 0);

const is_high = (code: number) => code >= 0xd800 && code <= 0xdbff;

const write_args = (content: string, path = "src/a.ts") => JSON.stringify({ path, content });

const tricky = 'line one\n\t"quoted" \\ back\\slash / slash\r\nunicode é é snowman ☃ emoji \u{1F600} end\\';

test("write_file content decodes to exactly what JSON.parse returns for every two-chunk split", () => {
  const raw = write_args(tricky);
  const expected = JSON.parse(raw) as { path: string; content: string };
  for (let cut = 0; cut <= raw.length; cut += 1) {
    const decoded = decode("write_file", [raw.slice(0, cut), raw.slice(cut)]);
    assert.equal(decoded.text, expected.content, `cut ${cut}`);
    assert.equal(decoded.path, expected.path, `cut ${cut}`);
    assert.equal(decoded.lines, line_count(expected.content), `cut ${cut}`);
  }
});

test("escapes split across chunks are held back until complete", () => {
  const raw = '{"path":"a","content":"x\\ny\\"z\\\\w\\u00e9\\ud83d\\ude00!"}';
  const expected = (JSON.parse(raw) as { content: string }).content;
  const by_char = decode("write_file", [...raw]);
  assert.equal(by_char.text, expected);
  let shown = "";
  for (const delta of by_char.deltas) {
    shown += delta;
    assert.ok(expected.startsWith(shown), `a partial escape leaked: ${JSON.stringify(shown)}`);
    assert.ok(!is_high(delta.charCodeAt(delta.length - 1)), `delta ends inside a surrogate pair: ${JSON.stringify(delta)}`);
  }
  const lone = create_draft_decoder("write_file");
  assert.ok(lone);
  lone.feed('{"content":"a\\');
  assert.equal(lone.take().delta, "a");
  lone.feed("n");
  assert.equal(lone.take().delta, "\n");
  lone.feed("\\u00");
  assert.equal(lone.pending(), false);
  lone.feed("e9\\ud83d");
  assert.equal(lone.take().delta, "é");
  assert.equal(lone.pending(), false);
  lone.feed("\\ude");
  assert.equal(lone.pending(), false);
  lone.feed('00"}');
  assert.equal(lone.take().delta, "\u{1F600}");
});

test("a raw surrogate pair split between chunks is never emitted in halves", () => {
  const emoji = "\u{1F600}";
  const raw = `{"content":"a${emoji}b"}`;
  const at = raw.indexOf(emoji) + 1;
  const decoded = decode("write_file", [raw.slice(0, at), raw.slice(at)]);
  assert.deepEqual(decoded.deltas, ["a", `${emoji}b`]);
});

test("a seeded random chunking of the tricky content always decodes exactly", () => {
  const raw = write_args(tricky.repeat(8));
  const expected = (JSON.parse(raw) as { content: string }).content;
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 60; round += 1) {
    const chunks: string[] = [];
    for (let at = 0; at < raw.length; ) {
      const size = 1 + Math.floor(next() * 9);
      chunks.push(raw.slice(at, at + size));
      at += size;
    }
    assert.equal(decode("write_file", chunks).text, expected, `round ${round}`);
  }
});

test("content before path streams the content and reports the path once its string closes", () => {
  const raw = '{"content":"one\\ntwo","path":"late/name.py"}';
  const chunks = ['{"content":"one', '\\ntwo","pa', 'th":"late/na', 'me.py', '"}'];
  assert.equal(chunks.join(""), raw);
  const decoded = decode("write_file", chunks);
  assert.equal(decoded.text, "one\ntwo");
  assert.equal(decoded.path, "late/name.py");
  assert.equal(decoded.path_at, 4);
  assert.equal(decoded.lines, 2);
});

test("the closing quote ends the streamed text and later fields never leak into it", () => {
  const decoder = create_draft_decoder("write_file");
  assert.ok(decoder);
  decoder.feed('{"path":"a.ts","content":"done"');
  assert.deepEqual(decoder.take(), { delta: "done", lines: 1, path: "a.ts", old_text: null });
  decoder.feed(',"content":"duplicate","extra":{"content":"nested \\"}\\" ]"},"n":12,"flag":true}');
  assert.equal(decoder.pending(), false);
  assert.equal(decoder.take().delta, "");
  const empty = decode("write_file", ['{"path":"e","content":""}']);
  assert.equal(empty.text, "");
  assert.equal(empty.lines, 0);
  assert.equal(empty.path, "e");
});

test("replace_in_file reports old_string only when it is complete before new_string starts", () => {
  const before = decode("replace_in_file", ['{"path":"a","old_', 'string":"x\\ny","new_string":"q', '\\nr\\ns"}']);
  assert.equal(before.old_text, "x\ny");
  assert.equal(before.old_at, 1);
  assert.equal(before.text, "q\nr\ns");
  assert.equal(before.lines, 3);
  const after = decode("replace_in_file", ['{"path":"a","new_string":"q"', ',"old_string":"x","expected_replacements":2}']);
  assert.equal(after.text, "q");
  assert.equal(after.old_text, null);
  assert.equal(after.path, "a");
});

test("only write_file and replace_in_file get a decoder, and a non-object stops decoding", () => {
  assert.equal(create_draft_decoder("read_file"), null);
  assert.equal(create_draft_decoder("toString"), null);
  const broken = decode("write_file", ['["content","x"]']);
  assert.equal(broken.text, "");
});

for (const name of recording_names) {
  test(`recorded ${name} stream decodes to the final content through the accumulator`, () => {
    const accumulator = create_accumulator();
    const out: Decoded = { text: "", deltas: [], path: null, old_text: null, lines: 0, path_at: -1, old_at: -1 };
    let step = 0;
    for (const chunk of recorded_chunks(load_recording(name))) {
      accumulator.push(chunk);
      const draft = accumulator.draft(0);
      if (draft) {
        drain(draft, out, step);
      }
      step += 1;
    }
    const done = accumulator.finish(new Set(["write_file"]), () => "call_x");
    const call = done.tool_calls[0];
    assert.equal(call?.name, "write_file");
    const parsed = JSON.parse(call.arguments) as { path: string; content: string };
    assert.equal(out.text, parsed.content);
    assert.equal(out.path, parsed.path);
    assert.equal(out.lines, line_count(parsed.content));
    assert.ok(out.lines > 50, `${name} wrote ${out.lines} lines`);
  });
}

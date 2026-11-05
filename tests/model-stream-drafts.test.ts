import assert from "node:assert/strict";
import { test } from "node:test";
import { set_key_source } from "../electron/model/key.ts";
import { draft_interval_ms } from "../electron/model/stream.ts";
import { load_recording, recording_names } from "./fixtures/live-code/recordings.ts";
import { chunk, run, write_spec, type Drafted, type Frame } from "./model-stream-harness.ts";

set_key_source(() => "sk-or-test-key");

const call = (value: Record<string, unknown>) => chunk({ tool_calls: [{ index: 0, type: "function", ...value }] });

const name_frame: Frame = { data: call({ id: "call_w", function: { name: "write_file", arguments: "" } }), at: 0 };

const joined = (drafts: Drafted[]) => drafts.map((draft) => draft.delta ?? "").join("");

const line_count = (text: string) => (text ? text.split("\n").length : 0);

const relaxed = { first_byte_ms: 5000, idle_ms: 5000 };

test("draft deltas are coalesced per read and reported at most every interval, with the rest flushed at the finish", async () => {
  const pieces = Array.from({ length: 20 }, (_, index) => `line ${String(index).padStart(2, "0")}\\n`);
  const frames: Frame[] = [
    name_frame,
    { data: call({ function: { arguments: '{"path":"a.py","content":"' } }), at: 5 },
    ...pieces.map((piece, index) => ({ data: call({ function: { arguments: piece } }), at: 10 * (index + 1) })),
    { data: call({ function: { arguments: 'end"}' } }) + chunk({}, "tool_calls"), at: 205 },
  ];
  const done = await run([{ frames }], { tools: [write_spec], transport: relaxed });
  const content = JSON.parse(done.result?.tool_calls[0]?.arguments ?? "{}").content as string;
  assert.equal(joined(done.drafts), content);
  assert.deepEqual(
    done.drafts.map((draft) => draft.at),
    [0, 80, 160, 205],
  );
  assert.equal(done.drafts[0]?.delta, undefined);
  assert.equal(done.drafts[1]?.path, "a.py");
  let shown = "";
  for (const draft of done.drafts) {
    shown += draft.delta ?? "";
    assert.equal(draft.lines, line_count(shown));
  }
  assert.equal(done.drafts.at(-1)?.lines, 21);
});

test("pending draft text is reported before text that arrives after it", async () => {
  const frames: Frame[] = [
    name_frame,
    { data: call({ function: { arguments: '{"path":"a","content":"x' } }), at: 10 },
    { data: chunk({ content: "note" }), at: 20 },
    { data: call({ function: { arguments: 'y"}' } }) + chunk({}, "tool_calls"), at: 30 },
  ];
  const done = await run([{ frames }], { tools: [write_spec], transport: relaxed });
  assert.deepEqual(done.log, ["draft:0:write_file:0", "draft:0:write_file:1", "text:note", "draft:0:write_file:1"]);
  assert.deepEqual(
    done.drafts.map((draft) => draft.delta ?? ""),
    ["", "x", "y"],
  );
});

test("a retried attempt starts its draft from scratch", async () => {
  const first: Frame[] = [name_frame, { data: call({ function: { arguments: '{"path":"a","content":"stale' } }), at: 100 }];
  const second: Frame[] = [
    { data: call({ id: "call_w", function: { name: "write_file", arguments: '{"path":"a","content":"fresh"}' } }), at: 300 },
    { data: chunk({}, "tool_calls"), at: 310 },
  ];
  const done = await run([{ frames: first }, { frames: second }], { tools: [write_spec], transport: relaxed });
  const retry_at = done.log.findIndex((line) => line.startsWith("retry:"));
  assert.ok(retry_at > 0);
  const before = done.log.slice(0, retry_at).filter((line) => line.startsWith("draft")).length;
  assert.equal(joined(done.drafts.slice(0, before)), "stale");
  assert.equal(joined(done.drafts.slice(before)), "fresh");
});

for (const name of recording_names) {
  test(`recorded ${name} stream replays into coalesced deltas that join to the final content`, async () => {
    const reads = load_recording(name).reads;
    const frames = reads.map((read) => ({ data: read.text, at: read.t }));
    const done = await run([{ frames }], { tools: [write_spec], transport: relaxed });
    assert.equal(done.error, null);
    const parsed = JSON.parse(done.result?.tool_calls[0]?.arguments ?? "{}") as { path: string; content: string };
    assert.equal(joined(done.drafts), parsed.content);
    assert.equal(done.drafts.find((draft) => draft.path !== undefined)?.path, parsed.path);
    assert.equal(done.drafts.at(-1)?.lines, line_count(parsed.content));
    const timed = done.drafts.slice(1, -1);
    for (let index = 1; index < timed.length; index += 1) {
      assert.ok(timed[index].at - timed[index - 1].at >= draft_interval_ms, `${name}: reports ${index - 1} and ${index} are closer than the interval`);
    }
    const span = (reads.at(-1)?.t ?? 0) - (reads[0]?.t ?? 0);
    assert.ok(done.drafts.length <= span / draft_interval_ms + 3, `${name}: ${done.drafts.length} reports over ${Math.round(span)} ms`);
  });
}

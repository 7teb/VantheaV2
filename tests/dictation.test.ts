import assert from "node:assert/strict";
import { test } from "node:test";
import { read_transcript, transcribe, transcription_body } from "../electron/media/dictation.ts";
import { ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import type { Transport } from "../electron/model/transport.ts";
import { audio_level, bar_height, bar_x, signal_rms, wave } from "../src/features/composer/dictation-wave.ts";
import { insert_dictation } from "../src/state/dictation-text.ts";

set_key_source(() => "sk-or-test-key");

const transport = (replies: { status: number; body: string }[]) => {
  const seen: { url: string; body: string }[] = [];
  const overrides: Partial<Transport> = {
    fetch: async (url, init) => {
      const reply = replies[Math.min(seen.length, replies.length - 1)] ?? { status: 500, body: "" };
      seen.push({ url, body: String(init.body) });
      return new Response(reply.body, { status: reply.status });
    },
    sleep: async () => {},
    random: () => 0,
  };
  return { overrides, seen };
};

test("the recording goes to the transcription endpoint as base64 webm with the catalog model", async () => {
  const audio = new Uint8Array([1, 2, 3, 250]);
  const { overrides, seen } = transport([{ status: 200, body: JSON.stringify({ text: "  Schau dir den Titlebar an.  ", usage: { seconds: 2 } }) }]);
  assert.equal(await transcribe("elevenlabs/scribe-v2", audio, overrides), "Schau dir den Titlebar an.");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "https://openrouter.ai/api/v1/audio/transcriptions");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), { model: "elevenlabs/scribe-v2", input_audio: { data: Buffer.from(audio).toString("base64"), format: "webm" } });
  assert.equal(transcription_body("elevenlabs/scribe-v2", audio), seen[0]?.body);
});

test("provider errors and unreadable bodies surface as model errors, a missing text as an empty transcript", async () => {
  assert.throws(() => read_transcript("not json"), (error: unknown) => error instanceof ModelError && error.kind === "provider_unavailable");
  assert.throws(() => read_transcript(JSON.stringify({ error: { code: 400, message: "Provider returned 400" } })), ModelError);
  assert.equal(read_transcript(JSON.stringify({ usage: { seconds: 1 } })), "");
  const { overrides } = transport([{ status: 400, body: JSON.stringify({ error: { code: 400, message: "Provider returned 400" } }) }]);
  await assert.rejects(transcribe("m", new Uint8Array([1]), overrides), (error: unknown) => error instanceof ModelError && error.kind === "bad_request");
});

test("dictated text lands at the caret with one space on each side where words would touch", () => {
  assert.deepEqual(insert_dictation("", null, "Hallo"), { text: "Hallo", caret: 5 });
  assert.deepEqual(insert_dictation("Fix this", null, "and the tests"), { text: "Fix this and the tests", caret: 22 });
  assert.deepEqual(insert_dictation("Fix  bug", 4, "the"), { text: "Fix the bug", caret: 7 });
  assert.deepEqual(insert_dictation("ab", 1, "X"), { text: "a X b", caret: 3 });
  assert.deepEqual(insert_dictation("line\n", 5, "next"), { text: "line\nnext", caret: 9 });
  assert.deepEqual(insert_dictation("abc", 99, "d"), { text: "abc d", caret: 5 });
});

test("the waveform maps quiet input to the floor, loud input to full height and scrolls without a jump", () => {
  assert.equal(signal_rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(signal_rms(new Float32Array([])), 0);
  assert.equal(audio_level(0), 0);
  assert.equal(audio_level(0.005), 0);
  assert.equal(audio_level(0.5), 1);
  assert.ok(audio_level(0.03) > 0 && audio_level(0.03) < audio_level(0.08));
  assert.equal(bar_height(0), wave.floor);
  assert.equal(bar_height(1), wave.height - wave.floor);
  assert.equal(bar_x(-1, 1), bar_x(0, 0));
  assert.equal(bar_x(0, 1), bar_x(1, 0));
  assert.equal(bar_x(0, 0), wave.width - wave.bar);
});

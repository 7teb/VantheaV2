import assert from "node:assert/strict";
import { test } from "node:test";
import { noted_text, output_cut_note } from "../electron/side/reply.ts";

test("a side reply cut at the provider's output limit carries an explicit note", () => {
  assert.equal(noted_text({ text: "The answer starts", finish_reason: "length" }), `The answer starts\n${output_cut_note}`);
  assert.match(output_cut_note, /output length limit/);
  assert.equal(noted_text({ text: "Complete answer.", finish_reason: "stop" }), "Complete answer.");
  assert.equal(noted_text({ text: "No reason given.", finish_reason: null }), "No reason given.");
});

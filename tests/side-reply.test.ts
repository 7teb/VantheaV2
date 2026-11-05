import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_canonical } from "../electron/memory/canonical.ts";
import { parse_candidates } from "../electron/memory/extract.ts";
import { noted_text, output_cut_note } from "../electron/side/reply.ts";

test("a side reply cut at the provider's output limit carries an explicit note", () => {
  assert.equal(noted_text({ text: "The answer starts", finish_reason: "length" }), `The answer starts\n${output_cut_note}`);
  assert.match(output_cut_note, /output length limit/);
  assert.equal(noted_text({ text: "Complete answer.", finish_reason: "stop" }), "Complete answer.");
  assert.equal(noted_text({ text: "No reason given.", finish_reason: null }), "No reason given.");
});

test("the cut note never breaks the JSON the memory jobs read from a reply", () => {
  const array = noted_text({ text: '[{"kind":"global_preference","key":"communication.language","text":"Answer in German."}]', finish_reason: "length" });
  assert.deepEqual(parse_candidates(array), [{ kind: "global_preference", key: "communication.language", text: "Answer in German." }]);
  const object = noted_text({ text: '{"kind":"project_rule","key":"project.tests","text":"Run npm test."}', finish_reason: "length" });
  assert.deepEqual(parse_canonical(object, "fallback"), { kind: "project_rule", key: "project.tests", text: "Run npm test.", failure: null });
});

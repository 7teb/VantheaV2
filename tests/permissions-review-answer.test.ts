import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_review_answer, type AnswerContext } from "../electron/permissions/review-answer.ts";

const context: AnswerContext = { blocking: new Set(["d4"]), known: new Set(["d1", "d4"]), scripts: false };

const answer = (fields: Record<string, unknown>) =>
  JSON.stringify({ rule_source: "none", rule: "", workaround_of: "", script_summary: "", reason: "Runs the tests.", decision: "allow", ...fields });

test("a valid answer keeps its fields", () => {
  const parsed = parse_review_answer(answer({ decision: "deny", rule_source: "custom_instructions", rule: "Never touch outputs.", reason: "Deletes outputs." }), "stop", context);
  assert.equal(parsed.kind, "answer");
  assert.deepEqual(parsed.kind === "answer" ? parsed.answer : null, {
    rule_source: "custom_instructions",
    rule: "Never touch outputs.",
    workaround_of: "",
    script_summary: "",
    reason: "Deletes outputs.",
    decision: "deny",
  });
});

test("fenced JSON and stray backslashes are repaired", () => {
  const fenced = parse_review_answer("```json\n" + answer({}) + "\n```", "stop", context);
  assert.equal(fenced.kind === "answer" && fenced.answer.decision, "allow");
  const windows = parse_review_answer('{"rule_source":"none","rule":"","workaround_of":"","script_summary":"","reason":"Reads C:\\Users\\a.txt","decision":"allow"}', "stop", context);
  assert.equal(windows.kind === "answer" && windows.answer.reason, "Reads C:\\Users\\a.txt");
});

test("unusable answers are unreadable, never allow", () => {
  for (const [text, finish] of [
    [answer({ decision: "ask" }), "stop"],
    ["", "stop"],
    [answer({}), "length"],
    [answer({ reason: "x".repeat(9000) }), "stop"],
    ["no json here", "stop"],
    ["[1,2]", "stop"],
  ] as const) {
    assert.equal(parse_review_answer(text, finish, context).kind, "unreadable", text.slice(0, 40));
  }
});

test("reasons and rules are trimmed and cut, unknown rule sources fall back to none", () => {
  const parsed = parse_review_answer(answer({ reason: `  ${"r".repeat(500)}  `, rule_source: "agent", rule: "x" }), "stop", context);
  assert.ok(parsed.kind === "answer");
  assert.equal(parsed.answer.reason.length, 400);
  assert.equal(parsed.answer.rule_source, "none");
  assert.equal(parsed.answer.rule, "");
  const empty_rule = parse_review_answer(answer({ rule_source: "project_file", rule: "  " }), "stop", context);
  assert.ok(empty_rule.kind === "answer");
  assert.equal(empty_rule.answer.rule_source, "none");
  const long_rule = parse_review_answer(answer({ rule_source: "project_file", rule: "y".repeat(300) }), "stop", context);
  assert.equal(long_rule.kind === "answer" && long_rule.answer.rule.length, 200);
});

test("the workaround_of table", () => {
  const named = parse_review_answer(answer({ decision: "deny", workaround_of: "d4" }), "stop", context);
  assert.ok(named.kind === "answer");
  assert.equal(named.workaround, "d4");
  const plain = parse_review_answer(answer({ decision: "deny" }), "stop", context);
  assert.ok(plain.kind === "answer");
  assert.equal(plain.workaround, null);
  for (const id of ["d1", "d99"]) {
    const dropped = parse_review_answer(answer({ decision: "deny", workaround_of: id }), "stop", context);
    assert.ok(dropped.kind === "answer");
    assert.equal(dropped.answer.decision, "deny");
    assert.equal(dropped.workaround, null);
    assert.equal(dropped.answer.workaround_of, "");
  }
  const on_review = parse_review_answer(answer({ decision: "review", workaround_of: "d4" }), "stop", context);
  assert.ok(on_review.kind === "answer");
  assert.equal(on_review.answer.decision, "review");
  assert.equal(on_review.workaround, null);
  assert.equal(parse_review_answer(answer({ decision: "allow", workaround_of: "d4" }), "stop", context).kind, "unreadable");
});

test("the script summary is kept only when scripts were sent, on one line and cut to 200", () => {
  const summary = `Reads config\nand writes ${"f".repeat(300)}`;
  const without = parse_review_answer(answer({ script_summary: summary }), "stop", context);
  assert.equal(without.kind === "answer" && without.answer.script_summary, "");
  const with_scripts = parse_review_answer(answer({ script_summary: summary }), "stop", { ...context, scripts: true });
  assert.ok(with_scripts.kind === "answer");
  assert.equal(with_scripts.answer.script_summary.length, 200);
  assert.ok(with_scripts.answer.script_summary.startsWith("Reads config and writes f"));
});

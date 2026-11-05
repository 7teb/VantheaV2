import assert from "node:assert/strict";
import { test } from "node:test";
import { review_statuses, type ReviewStatus } from "../electron/permissions/review-prompt.ts";
import { approved_note, deny_text, earlier_line, not_approved_text, scripts_changed_text, stopped_text, user_denied_text, workaround_text } from "../electron/permissions/verdict-text.ts";

const ruled = { reason: "Deletes dist with a raw PowerShell command.", rule_source: "custom_instructions" as const, rule: "Never delete files with raw PowerShell commands." };

test("deny carries the reason, the rule and the allowed-way sentence", () => {
  const text = deny_text("command", ruled);
  assert.match(text, /^Denied by the automatic review\. The command did not run\.\nReason: Deletes dist/);
  assert.match(text, /Rule \(the user's custom instructions\): "Never delete files with raw PowerShell commands\."/);
  assert.match(text, /If the reason or the rule names an allowed way, use that way\./);
  const bare = deny_text("tool call", { reason: "", rule_source: "none", rule: "" });
  assert.match(bare, /The tool call did not run\.\nReason: none given\.\nDo not run it again/);
  assert.doesNotMatch(bare, /Rule \(/);
});

test("user denial shows the automatic review line only with a model reason", () => {
  assert.match(user_denied_text("command", "use npm run clean", "Deletes dist."), /It did not run\.\nAutomatic review: Deletes dist\.\nUser feedback: use npm run clean\n/);
  const plain = user_denied_text("command", "", null);
  assert.doesNotMatch(plain, /Automatic review/);
  assert.match(plain, /User feedback: none\./);
});

test("an expired card reads as an automatic denial with the review's reason", () => {
  const expired = not_approved_text("command", { approved: false, grant: "once", feedback: "", expired: true }, "Deletes dist.");
  assert.match(expired, /^Denied automatically\. The command did not run\.\nReason: Deletes dist\.\n/);
  assert.doesNotMatch(expired, /The user denied|seconds|answer/);
  assert.match(not_approved_text("command", { approved: false, grant: "once", feedback: "", expired: true }, null), /\nReason: none given\.\n/);
  assert.equal(not_approved_text("command", { approved: false, grant: "once", feedback: "no" }, null), user_denied_text("command", "no", null));
});

test("the workaround text names the earlier action by status", () => {
  const phrases: [ReviewStatus, string][] = [
    [review_statuses.user_denied, "the user denied"],
    [review_statuses.repeat_denied, "the user denied"],
    [review_statuses.review_denied, "the automatic review denied"],
    [review_statuses.blocked, "the app blocks"],
    [review_statuses.waiting, "the user has not approved yet"],
    [review_statuses.unanswered, "the user has not approved yet"],
  ];
  for (const [status, phrase] of phrases) {
    const text = workaround_text("command", ruled, earlier_line("git push origin main", status, null));
    assert.ok(text.includes(`an earlier action that ${phrase}: git push origin main\n`), status);
  }
  const long = earlier_line("x".repeat(400), review_statuses.repeat_denied, "tests#1a2b3c4d");
  assert.deepEqual({ ...long, action: long.action.length }, { action: 301, status: "user_denied", agent: "tests#1a2b3c4d" });
  assert.match(workaround_text("command", ruled, long), /x{300}… \(by tests#1a2b3c4d\)/);
});

test("approved, stopped and scripts-changed texts", () => {
  assert.equal(approved_note("tool call"), "The user approved this tool call. The approval covers this exact tool call only.");
  assert.match(stopped_text("command"), /^Not run: the turn was stopped while this command waited/);
  assert.match(scripts_changed_text(["a.ps1", "b.py"]), /three times \(a\.ps1, b\.py\)\. The command was not executed\./);
});

test("a denial ends the one action, not the turn, the rest of the task or running sub-agents", () => {
  const denied = deny_text("command", ruled);
  const around = workaround_text("command", ruled, earlier_line("git push origin main", review_statuses.user_denied, null));
  const scope = "it does not end your turn and does not stop sub-agents or other work.";
  assert.ok(denied.endsWith(`This covers this action only: ${scope}`), denied);
  assert.ok(around.endsWith(`This covers this approach only: ${scope}`), around);
  for (const text of [denied, around]) {
    assert.match(text, /continue with the rest of the task/i);
    assert.doesNotMatch(text, /Otherwise stop|Stop this approach/);
  }
  assert.match(not_approved_text("command", { approved: false, grant: "once", feedback: "", expired: true }, null), /Continue with the rest of the task/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest, HumanDecision } from "../shared/approval.ts";
import type { ToolStep } from "../shared/chat.ts";
import type { ReviewNote, ReviewRecord } from "../shared/review.ts";
import { approval_lines, step_outcome } from "../src/features/tools/review-notes.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const note = (extra: Partial<ReviewNote> = {}): ReviewNote => ({ id: "r1", source: "model", reason: "Pushes main to origin.", rule_source: "none", rule: "", ...extra });

const command = (review: ReviewNote | null, extra: Partial<Extract<ApprovalRequest, { kind: "command" }>> = {}): ApprovalRequest => ({
  kind: "command",
  command: "git push origin main",
  cwd: "C:/work",
  background: false,
  review,
  grant_prefix: null,
  ...extra,
});

const texts = (request: ApprovalRequest, translate_with: Translate = t) => approval_lines(translate_with, request).map((line) => `${line.tone}|${line.text}`);

test("a model review shows the rule minimums first, then the reason and the rule", () => {
  assert.deepEqual(texts(command(note())), ["plain|Automatic review: Pushes main to origin."]);
  const ruled = note({ rule_source: "custom_instructions", rule: "Never push.", raised_by: ["script_floor", "plan"], script_floor: ["tools/x.ps1: Format-Volume", "tools/y.ps1: Clear-Disk"] });
  assert.deepEqual(texts(command(ruled)), [
    "plain|Plan mode lets only read-only commands run without your approval.",
    "plain|A script this command runs contains a destructive system operation: tools/x.ps1: Format-Volume (+1)",
    "plain|Automatic review: Pushes main to origin.",
    "plain|Custom instructions: \u201cNever push.\u201d",
  ]);
  assert.deepEqual(texts(command(note({ reason: "", raised_by: ["script_floor"], script_floor: ["tools/x.ps1: Format-Volume"] })), de), [
    "plain|Ein Skript, das dieser Befehl ausf\u00fchrt, enth\u00e4lt eine zerst\u00f6rerische Systemoperation: tools/x.ps1: Format-Volume",
    "plain|Automatische Pr\u00fcfung: Keine Begr\u00fcndung angegeben.",
  ]);
});

test("an unavailable review shows the waiting title and the failure text", () => {
  assert.deepEqual(texts(command(note({ source: "unavailable", reason: "", failure: "timeout" }))), [
    "waiting|Automatic review unavailable",
    "plain|The automatic review did not answer within 60 s. Nothing has run yet.",
  ]);
  assert.deepEqual(texts(command(note({ source: "unavailable", reason: "", failure: "credits" }))).at(-1), "plain|The OpenRouter account has no credits left for the automatic review. Nothing has run yet.");
});

test("plan, recheck, instruction-file and MCP cards carry their own lines", () => {
  assert.deepEqual(texts(command(null, { plan: true })), []);
  assert.deepEqual(texts(command(null, { plan: true, plan_rule: true })), ["plain|Plan mode lets only read-only commands run without your approval."]);
  assert.deepEqual(texts(command(null, { rechecked: true })), ["plain|A script this command runs changed after the last review and was reviewed again."]);
  assert.deepEqual(texts({ kind: "write", path: "AGENTS.md", created: false, added: 1, removed: 0, diff: [], instruction_file: true }), [
    "plain|This changes AGENTS.md or CLAUDE.md, the rules the automatic review checks against.",
  ]);
  assert.deepEqual(texts({ kind: "write", path: "a.ts", created: false, added: 1, removed: 0, diff: [] }), []);
  assert.deepEqual(texts({ kind: "mcp", server: "ida", tool: "patch", tier: "dangerous", args_preview: "", scope: null, reason: "Ask mode confirms every MCP tool call." }), [
    "plain|Ask mode confirms every MCP tool call.",
  ]);
  assert.deepEqual(texts({ kind: "mcp", server: "ida", tool: "patch", tier: "dangerous", args_preview: "", scope: null, review: note({ reason: "Writes memory." }) }), [
    "plain|Automatic review: Writes memory.",
  ]);
});

const record = (extra: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: "r1",
  at: 1,
  actor: { id: "main", name: "main", kind: "main" },
  tool: "run_command",
  subject: "git push origin main",
  cwd: "C:/work",
  verdict: "review",
  source: "model",
  reason: "Pushes main to origin.",
  rule_source: "none",
  rule: "",
  last_human_id: null,
  ...extra,
});

const decision = (approved: boolean, extra: Partial<HumanDecision> = {}): HumanDecision => ({
  id: "d1",
  at: 2,
  actor: "main",
  tool: "run_command",
  subject: "git push origin main",
  cwd: "C:/work",
  approved,
  grant: "once",
  feedback: "",
  reason: "",
  review_id: "r1",
  ...extra,
});

const tool_step = (status: ToolStep["status"], reviews: ReviewRecord[], decisions: HumanDecision[] = []): ToolStep => ({
  id: "tool:1:run_command",
  round: 1,
  kind: "tool",
  index: 0,
  call_id: "c1",
  name: "run_command",
  args: { command: "git push origin main" },
  status,
  started_at: null,
  ended_at: null,
  result_text: "",
  view: null,
  error: null,
  approval: null,
  progress: null,
  reviews,
  decisions,
});

const outcome = (step: ToolStep, translate_with: Translate = t) => {
  const result = step_outcome(translate_with, step);
  return { notice: result.notice && [result.notice.title, ...result.notice.lines.map((line) => `${line.tone}|${line.text}`)], footer: result.footer };
};

test("denials show who denied and only the review reason", () => {
  assert.deepEqual(outcome(tool_step("denied", [record({ verdict: "deny", rule_source: "project_file", rule: "Never push." })])), {
    notice: ["Denied by the automatic review", "reason|Pushes main to origin."],
    footer: [],
  });
  const workaround = record({ verdict: "deny", circumvents: "r0", earlier: { action: "git push origin main", status: "user_denied", agent: null } });
  assert.deepEqual(outcome(tool_step("denied", [workaround])).notice, ["Denied: workaround attempt", "reason|Pushes main to origin."]);
  const by_agent = record({ verdict: "deny", reason: "", earlier: { action: "npm publish", status: "waiting", agent: "tests#1a2b" } });
  assert.deepEqual(outcome(tool_step("denied", [by_agent]), de).notice, ["Abgelehnt: Umgehungsversuch", "reason|Keine Begr\u00fcndung angegeben."]);
  assert.deepEqual(outcome(tool_step("denied", [record()], [decision(false, { feedback: " use a branch " })])).notice, [
    "Denied by you",
    "reason|Automatic review: Pushes main to origin.",
    "detail|Your feedback: use a branch",
  ]);
  assert.deepEqual(outcome(tool_step("denied", [record()], [decision(false, { expired: true })])).notice, ["Denied by the automatic review", "reason|Pushes main to origin."]);
  assert.equal(outcome(tool_step("denied", [record({ source: "unavailable", reason: "", failure: "timeout" })], [decision(false)])).notice, null);
  assert.equal(outcome(tool_step("denied", [], [decision(false, { review_id: undefined })])).notice, null);
  assert.equal(outcome(tool_step("denied", [])).notice, null);
  assert.deepEqual(outcome(tool_step("denied", [record({ superseded: "scripts_changed" })], [decision(true)])).notice, ["Not run: a script it runs changed three times during the review"]);
});

test("a floor block names the app, and commands that ran note how they were allowed", () => {
  assert.deepEqual(outcome(tool_step("failed", [record({ verdict: "deny", source: "floor", reason: "formats a drive" })])).notice, ["Blocked: VantheaX never runs this command", "reason|formats a drive"]);
  assert.deepEqual(outcome(tool_step("done", [record({ verdict: "allow" })])), { notice: null, footer: [] });
  assert.deepEqual(outcome(tool_step("done", [record({ verdict: "allow", granted: true, grant_prefixes: ["git push", "npm run"] })])).footer, ["Allowed by your choice for commands starting with: git push, npm run"]);
  assert.deepEqual(outcome(tool_step("failed", [record()], [decision(true)])).footer, ["Approved by you"]);
  assert.deepEqual(outcome(tool_step("done", [record({ source: "unavailable", reason: "", failure: "network" })], [decision(true)])).footer, ["Approved by you without automatic review"]);
  assert.deepEqual(outcome(tool_step("done", [record({ superseded: "scripts_changed" }), record({ id: "r2", verdict: "allow" })], [decision(true)])).footer, []);
  assert.deepEqual(outcome(tool_step("done", [], [decision(true, { review_id: undefined })])).footer, ["Approved by you"]);
  assert.deepEqual(outcome(tool_step("cancelled", [record()])), { notice: null, footer: [] });
});

import assert from "node:assert/strict";
import child_process from "node:child_process";
import { test, type TestContext } from "node:test";
import type { AssistantMessage, ToolStep } from "../shared/chat.ts";
import { action_lines } from "../electron/permissions/review-lines.ts";
import { assemble_review, type ReviewInput } from "../electron/permissions/review-request.ts";
import { tool_steps_in } from "../electron/permissions/review-records.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";

type ScopedStep = ToolStep & { response_id?: string };
let sequence = 0;
const step = (index: number, name: string, status: ToolStep["status"] = "running", round = 1, response_id: string | undefined = "answer"): ScopedStep => ({
  id: `tool:${round}:${index}`, round, index, kind: "tool", call_id: `c${round}_${index}`, name: "deploy_agent", args: { name, task: `Fix ${name}` },
  status, progress: { label: "", lines: null, output_tail: null, phase: "review" }, approval: null, view: null, error: null, result_text: "", started_at: 1, ended_at: null,
  ...(response_id ? { response_id } : {}),
});
const input = (steps: ScopedStep[], call_id: string, chat_id = `parallel-review-${++sequence}`): ReviewInput => ({
  chat: { chat_id, project_root: "", custom_instructions: "", humans: [{ id: "human", at: 1, text: "Fix both bugs using exactly two agents." }],
    profile: { root: "", git: "not a repository", listing: "", readme: null, scripts: null }, snapshot: { anchor: "human", number: 1, after_restart: false, files: [] } },
  chat_key: "fixture", agent: { actor: { id: "main", name: "Main", kind: "main" }, model: { id: "fixture", label: "Fixture" }, profile: "main", delegated_task: null, earlier_commands: 0 },
  source: { records: [], decisions: [], steps }, mark: "human", call_id,
  action: { tool: "deploy_agent", subject: JSON.stringify(steps.findLast((entry) => entry.call_id === call_id)?.args ?? {}), cwd: "", background: false,
    call: { kind: "tool" }, files: [], gaps: [], changed: [], edits: { text: "", since: 1 }, facts: [] },
});
const history = (review: ReturnType<typeof assemble_review>) => review.call.parts.slice(0, -1).map((part) => part.text).join("");
const current = (review: ReturnType<typeof assemble_review>) => review.call.parts.at(-1)?.text ?? "";
const no_processes = (context: TestContext) => {
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
    context.mock.method(child_process, method, () => { throw new Error("Offline review tests must never start a process"); });
  context.mock.method(child_process.ChildProcess.prototype as unknown as { spawn: (...args: unknown[]) => unknown }, "spawn", () => { throw new Error("Offline review tests must never start a process"); });
  context.mock.method(globalThis, "fetch", () => { throw new Error("Offline review tests must never call an API"); });
};

test("two same-response deploy reviews see siblings as batch requests, not earlier running agents", (context) => {
  no_processes(context);
  const steps = [step(0, "DiffFix"), step(1, "IncFix")];
  for (const [index, other] of [[0, "IncFix"], [1, "DiffFix"]] as const) {
    const review = assemble_review(input(steps, steps[index].call_id), undefined, () => "fixture");
    assert.doesNotMatch(history(review), /DiffFix|IncFix/);
    assert.ok(current(review).includes(other), "sibling is shown in the pending context");
    assert.match(current(review), /same response.*reviewed separately/i);
  }
});

test("prior responses with reused round, call and step IDs remain historical", (context) => {
  no_processes(context);
  const steps = [step(0, "PriorA", "done", 1, "prior"), step(1, "PriorB", "done", 1, "prior"), step(0, "DiffFix"), step(1, "IncFix")];
  const review = assemble_review(input(steps, "c1_0"), undefined, () => "fixture");
  assert.match(history(review), /PriorA/);
  assert.match(history(review), /PriorB/);
  assert.doesNotMatch(history(review), /DiffFix|IncFix/);
  assert.match(current(review), /IncFix/);
});

test("same response earlier rounds stay historical and queued siblings stay in pending", (context) => {
  no_processes(context);
  const steps = [step(0, "EarlierRound", "done", 0), step(0, "DiffFix"), step(1, "IncFix", "queued")];
  const review = assemble_review(input(steps, "c1_0"), undefined, () => "fixture");
  assert.match(history(review), /EarlierRound/);
  assert.doesNotMatch(history(review), /IncFix/);
  assert.match(current(review), /IncFix/);
  assert.match(current(review), /"status":"queued"/);
});

test("completed and failed siblings retain their actual tool-call statuses", (context) => {
  no_processes(context);
  for (const status of ["done", "failed", "denied", "cancelled", "awaiting_approval"] as const) {
    const review = assemble_review(input([step(0, "DiffFix"), step(1, "IncFix", status)], "c1_0"), undefined, () => "fixture");
    assert.doesNotMatch(history(review), /IncFix/);
    assert.match(current(review), new RegExp(`"status":"${status}"`));
  }
});

test("an unknown current call removes no history and creates no guessed batch", (context) => {
  no_processes(context);
  const review = assemble_review(input([step(0, "PriorA", "done"), step(1, "PriorB")], "missing"), undefined, () => "fixture");
  assert.match(history(review), /PriorA/);
  assert.match(history(review), /PriorB/);
  assert.doesNotMatch(current(review), /same response/i);
});

test("cached historical blocks cannot retain a sibling reclassified into pending", (context) => {
  no_processes(context);
  const chat_id = `parallel-review-cache-${++sequence}`;
  const steps = [step(0, "DiffFix"), step(1, "IncFix")];
  assemble_review(input(steps, "unknown", chat_id), undefined, () => "fixture");
  const review = assemble_review(input(steps, "c1_0", chat_id), undefined, () => "fixture");
  assert.doesNotMatch(history(review), /DiffFix|IncFix/);
  assert.match(current(review), /IncFix/);
  clear_review_chat(chat_id);
});

test("chat history copies carry response scope without changing stored ToolSteps", (context) => {
  no_processes(context);
  const original = step(0, "Prior", "done", 1, undefined);
  delete original.response_id;
  const message = { id: "response-id", role: "assistant", steps: [original] } as AssistantMessage;
  const found = tool_steps_in([message]) as ScopedStep[];
  assert.equal(found[0]?.response_id, "response-id");
  assert.equal(original.response_id, undefined);
  assert.equal(action_lines(found, [], "missing")[0]?.key, "response-id:tool:1:0");
});

test("single-run agent history without response metadata still separates sibling requests", (context) => {
  no_processes(context);
  const steps = [step(0, "DiffFix"), step(1, "IncFix")];
  for (const entry of steps) delete entry.response_id;
  const review = assemble_review(input(steps, "c1_0"), undefined, () => "fixture");
  assert.doesNotMatch(history(review), /DiffFix|IncFix/);
  assert.match(current(review), /IncFix/);
});

test("ambiguous legacy IDs without response metadata remove only the exact pending step", (context) => {
  no_processes(context);
  const steps = [step(0, "Prior", "done"), step(0, "Current"), step(1, "PossibleSibling")];
  for (const entry of steps) delete entry.response_id;
  const review = assemble_review(input(steps, "c1_0"), undefined, () => "fixture");
  assert.match(history(review), /Prior/);
  assert.match(history(review), /PossibleSibling/);
  assert.doesNotMatch(history(review), /Current/);
  assert.doesNotMatch(current(review), /same response/i);
});

test("draft stream fragments are not treated as requested sibling actions", (context) => {
  no_processes(context);
  const review = assemble_review(input([step(0, "Current"), step(1, "Queued", "queued"), step(2, "Incomplete", "drafting")], "c1_0"), undefined, () => "fixture");
  assert.doesNotMatch(history(review), /Queued|Incomplete/);
  assert.match(current(review), /Queued/);
  assert.doesNotMatch(current(review), /Incomplete/);
});

test("a completed call ID alone does not invent a pending batch", (context) => {
  no_processes(context);
  const review = assemble_review(input([step(0, "PriorA", "done"), step(1, "PriorB", "done")], "c1_0"), undefined, () => "fixture");
  assert.match(history(review), /PriorA/);
  assert.match(history(review), /PriorB/);
  assert.doesNotMatch(current(review), /same response/i);
});

test("sibling review denials remain earlier decisions with unchanged blocking meaning", (context) => {
  no_processes(context);
  const sibling = step(1, "DeniedSibling", "denied");
  const request = input([step(0, "Current"), sibling], "c1_0");
  const record = { id: "sibling-denial", at: 1, actor: request.agent.actor, tool: "deploy_agent", subject: "DeniedSibling", cwd: "", verdict: "deny" as const,
    source: "model" as const, reason: "An actual restriction forbids this action.", rule_source: "human_message" as const, rule: "Do not edit that file.", last_human_id: "human" };
  sibling.reviews = [record];
  request.source.records = [record];
  const review = assemble_review(request, undefined, () => "fixture");
  const decision = review.lines.find((line) => line.key === record.id);
  assert.equal(decision?.blocking, true);
  assert.match(history(review), /"status":"denied by the review"/);
  assert.match(current(review), /DeniedSibling/);
  assert.match(review.call.system, /This includes the exact same command after a denial/);
});

test("response namespaces keep reused action IDs distinct across warm cache updates", (context) => {
  no_processes(context);
  const chat_id = `parallel-review-scope-${++sequence}`;
  const prior = step(0, "Prior", "done", 1, "prior");
  const batch = [step(0, "DiffFix"), step(1, "IncFix")];
  assemble_review(input([prior], "missing", chat_id), undefined, () => "fixture");
  const pending = assemble_review(input([prior, ...batch], "c1_0", chat_id), undefined, () => "fixture");
  assert.match(history(pending), /Prior/);
  assert.doesNotMatch(history(pending), /DiffFix|IncFix/);
  for (const entry of batch) entry.status = "done";
  const next = assemble_review(input([prior, ...batch, step(0, "Next", "running", 2)], "c2_0", chat_id), undefined, () => "fixture");
  assert.match(history(next), /Prior/);
  assert.match(history(next), /DiffFix/);
  assert.match(history(next), /IncFix/);
  assert.deepEqual(action_lines([prior, batch[0]], [], "missing").map((line) => line.key), ["prior:tool:1:0", "answer:tool:1:0"]);
  clear_review_chat(chat_id);
});

test("batch context applies equally to continuation and background tools", (context) => {
  no_processes(context);
  const other = { ...step(1, "ignored", "queued"), name: "continue_agent", args: { agent_id: "existing-agent", prompt: "Continue the fix" } };
  const background = { ...step(2, "ignored", "done"), name: "start_background_task", args: { command: "fixture-command", shell: "powershell" }, view: { kind: "command" as const, command: "fixture-command", shell: "PowerShell", cwd: "", exit_code: 0, output: "", timed_out: false, duration_ms: 1 } };
  const review = assemble_review(input([step(0, "Current"), other, background], "c1_0"), undefined, () => "fixture");
  assert.doesNotMatch(history(review), /continue_agent|start_background_task/);
  assert.match(current(review), /"tool":"continue_agent"/);
  assert.match(current(review), /"tool":"start_background_task"/);
  assert.match(current(review), /"status":"done","exit":0/);
});

test("agent identities in pending summaries do not depend on JSON argument order", (context) => {
  no_processes(context);
  const deploy = { ...step(1, "ignored"), args: { prompt: "A long task description", profile: "worker", name: "IncFix" } };
  const continuation = { ...step(2, "ignored"), name: "continue_agent", args: { prompt: "Continue the task", agent_id: "agent-existing" } };
  const review = assemble_review(input([step(0, "Current"), deploy, continuation], "c1_0"), undefined, () => "fixture");
  assert.match(current(review), /"tool":"deploy_agent","arg":"IncFix"/);
  assert.match(current(review), /"tool":"continue_agent","arg":"agent-existing"/);
  assert.deepEqual(Object.keys(deploy.args), ["prompt", "profile", "name"]);
});

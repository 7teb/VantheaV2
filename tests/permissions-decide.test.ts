import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { HumanDecision } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import type { ReviewFailure, ReviewRecord } from "../shared/review.ts";
import { ModelError } from "../electron/model/errors.ts";
import { decide_command, type CommandInput } from "../electron/permissions/decide.ts";
import { human_decision } from "../electron/permissions/decisions.ts";
import { mcp_command_gate } from "../electron/permissions/mcp-gate.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { answer, main_review_actor, review_stub } from "./review-stub.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

const windows_dir = ["C:", "Windows"].join("\\");

let chats = 0;

const input = (mode: PermissionMode, command: string, extra: Partial<CommandInput> = {}): CommandInput => ({
  command,
  background: false,
  mode,
  app_root: "C:\\Users\\user\\AppData\\Roaming\\VantheaX",
  project_root: "",
  cwd: "",
  plan: false,
  chat_id: `decide-${(chats += 1)}`,
  chat_started_at: Date.now(),
  call_id: "c1_0",
  profile: "main",
  custom_instructions: "",
  decisions: [],
  last_human_id: null,
  changed: [],
  shell: "powershell",
  ...extra,
});

const signal = () => new AbortController().signal;

const prefix_approval = (prefix: string, subject: string): HumanDecision => ({
  id: `p-${prefix}`, at: 1, actor: "main", tool: "run_command", subject, cwd: "", approved: true, grant: "prefix", feedback: "", reason: "", grant_prefix: prefix,
});

const temp_project = async (files: Record<string, string>) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-decide-"));
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(root, name), body);
  return root;
};

test("the floor blocks in every mode and is recorded as a floor deny", async () => {
  const decisions = [prefix_approval("Remove-Item", "Remove-Item dist")];
  for (const mode of ["ask", "auto", "full"] as const) {
    const stub = review_stub();
    const decision = await decide_command(input(mode, `Remove-Item ${windows_dir} -Recurse`, { decisions }), stub, signal());
    assert.equal(decision.action, "block", mode);
    assert.equal(decision.record?.verdict, "deny");
    assert.equal(decision.record?.source, "floor");
    assert.equal(stub.calls.length, 0);
  }
  assert.equal((await decide_command(input("full", "   "), review_stub(), signal())).action, "block");
});

test("full mode runs and ask mode always asks, neither calls the classifier", async () => {
  const stub = review_stub();
  assert.equal((await decide_command(input("full", "npm install -g something"), stub, signal())).action, "run");
  const decisions = [prefix_approval("npm run", "npm run build")];
  const asked = await decide_command(input("ask", "npm run build", { decisions }), stub, signal());
  assert.equal(asked.action, "ask");
  assert.equal(asked.grant_prefix, null);
  assert.equal(asked.record, null);
  const denied: HumanDecision = { ...prefix_approval("x", "git push"), approved: false, grant: "once", grant_prefix: undefined };
  assert.equal((await decide_command(input("ask", "git push", { decisions: [denied] }), stub, signal())).action, "ask");
  assert.equal(stub.calls.length, 0);
  const plan = await decide_command(input("full", "npm run build", { plan: true }), stub, signal());
  assert.equal(plan.action, "ask");
  assert.equal(plan.plan, true);
});

test("auto mode calls the classifier for every command, read-only ones included", async () => {
  const stub = review_stub([answer("allow"), answer("review", "rewrites remote history"), answer("deny", "pushes to main")]);
  const read = await decide_command(input("auto", "git diff; Get-ChildItem src"), stub, signal());
  assert.equal(read.action, "run");
  assert.equal(read.record?.verdict, "allow");
  const flagged = await decide_command(input("auto", "git push --force"), stub, signal());
  assert.equal(flagged.action, "ask");
  assert.equal(flagged.note?.reason, "rewrites remote history");
  assert.equal(flagged.grant_prefix, "git push");
  const denied = await decide_command(input("auto", "git push origin main"), stub, signal());
  assert.equal(denied.action, "deny");
  assert.match(denied.reason, /^Denied by the automatic review\. The command did not run\.\nReason: pushes to main/);
  assert.equal(stub.calls.length, 3);
});

test("rule minimums raise an allow to review and leave a deny alone", async () => {
  const secret = await decide_command(input("auto", "Get-Content .env"), review_stub([answer("deny", "no user message allows reading .env, the agent has to ask the user in chat")]), signal());
  assert.equal(secret.action, "deny");
  assert.equal(secret.record?.raised_by, undefined);
  assert.match(secret.reason, /Reason: no user message allows reading .env, the agent has to ask the user in chat/);
  const allowed = await decide_command(input("auto", "Get-Content .env"), review_stub([answer("allow")]), signal());
  assert.equal(allowed.action, "run");
  assert.equal(allowed.record?.raised_by, undefined);
  const plan = await decide_command(input("auto", "New-Item notes.txt", { plan: true }), review_stub([answer("allow")]), signal());
  assert.deepEqual(plan.record?.raised_by, ["plan"]);
  assert.equal(plan.plan, true);
  const read_plan = await decide_command(input("auto", "git status", { plan: true }), review_stub([answer("allow")]), signal());
  assert.equal(read_plan.action, "run");
});

test("inspection gaps go to the review as information and its verdict stands", async () => {
  const stub = review_stub([answer("allow"), answer("review", "cannot tell what $script is"), answer("deny")]);
  const gap = await decide_command(input("auto", "python $script"), stub, signal());
  assert.equal(gap.action, "run");
  assert.equal(gap.record?.raised_by, undefined);
  assert.match(stub.calls[0]?.parts.at(-1)?.text ?? "", /INSPECTION GAPS:\n.*\$script/);
  const asked = await decide_command(input("auto", "python $script"), stub, signal());
  assert.equal(asked.action, "ask");
  assert.equal(asked.note?.reason, "cannot tell what $script is");
  assert.equal((await decide_command(input("auto", "python $script"), stub, signal())).action, "deny");
});

test("a started script that fits the request is sent whole, with no gap", async () => {
  const root = await temp_project({ "big.ps1": "Write-Output 'x'\n".repeat(8000) });
  const stub = review_stub([answer("allow")]);
  const allowed = await decide_command(input("auto", ".\\big.ps1", { project_root: root, cwd: root }), stub, signal());
  assert.equal(allowed.action, "run");
  const text = stub.calls[0]?.parts.at(-1)?.text ?? "";
  assert.equal(text.split("Write-Output 'x'").length - 1, 8000);
  assert.doesNotMatch(text, /Script not sent/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a started script over the whole request cap is listed as a gap and the review decides", async () => {
  const root = await temp_project({ "big.ps1": "Write-Output 'x'\n".repeat(25000) });
  const decisions = [prefix_approval(".\\big.ps1", ".\\big.ps1")];
  const stub = review_stub([answer("allow")]);
  const allowed = await decide_command(input("auto", ".\\big.ps1", { project_root: root, cwd: root }), stub, signal());
  assert.equal(allowed.action, "run");
  assert.equal(allowed.record?.raised_by, undefined);
  assert.match(stub.calls[0]?.parts.at(-1)?.text ?? "", /INSPECTION GAPS:\nScript not sent, over the review budget: big\.ps1/);
  const granted = await decide_command(input("auto", ".\\big.ps1", { project_root: root, cwd: root, decisions }), review_stub([answer("review")]), signal());
  assert.equal(granted.action, "run");
  assert.equal(granted.record?.granted, true);
  const denied = await decide_command(input("auto", ".\\big.ps1", { project_root: root, cwd: root }), review_stub([answer("deny")]), signal());
  assert.equal(denied.action, "deny");
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("the same command after an unanswered card goes back to the human, a different one is denied as a workaround", async () => {
  const earlier: ReviewRecord = {
    id: "r-old", at: 1, actor: main_review_actor, tool: "run_command", subject: "git push", cwd: "", verdict: "review", source: "model", reason: "pushes", rule_source: "none", rule: "", last_human_id: null,
  };
  const same = review_stub([answer("deny", "asked before", { workaround_of: "d1" })]);
  same.records = [earlier];
  const asked = await decide_command(input("auto", "git push"), same, signal());
  assert.equal(asked.action, "ask");
  assert.equal(asked.record?.circumvents, undefined);
  assert.match(same.calls[0]?.parts.map((part) => part.text).join("") ?? "", /"action":"git push".*"status":"not answered"/);
  const other = review_stub([answer("deny", "same effect", { workaround_of: "d1" })]);
  other.records = [earlier];
  const denied = await decide_command(input("auto", "git push --force"), other, signal());
  assert.equal(denied.action, "deny");
  assert.equal(denied.record?.circumvents, "r-old");
});

test("a prefix grant turns only a plain model review into allow", async () => {
  const decisions = [prefix_approval("cargo", "cargo build")];
  const granted = await decide_command(input("auto", "cargo check", { decisions }), review_stub([answer("review")]), signal());
  assert.equal(granted.action, "run");
  assert.equal(granted.record?.granted, true);
  assert.deepEqual(granted.record?.grant_prefixes, ["cargo"]);
  assert.equal((await decide_command(input("auto", "cargo check", { decisions }), review_stub([answer("deny")]), signal())).action, "deny");
  assert.equal((await decide_command(input("auto", "cargo run", { decisions, plan: true }), review_stub([answer("review")]), signal())).action, "ask");
  const unavailable = await decide_command(input("auto", "cargo check", { decisions }), review_stub([new ModelError("auth", "no key")]), signal());
  assert.equal(unavailable.action, "ask");
  assert.equal(unavailable.record?.failure, "auth");
});

test("a large executable built in this chat is a program fact, raises nothing and keeps the prefix option", async () => {
  const root = await temp_project({});
  await fs.mkdir(path.join(root, "Release"));
  await fs.writeFile(path.join(root, "Release", "example.exe"), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(1350000 - 2)]));
  const stub = review_stub([answer("review", "runs a test binary")]);
  const decision = await decide_command(input("auto", ".\\Release\\example.exe check out.txt", { project_root: root, cwd: root, chat_started_at: 0 }), stub, signal());
  assert.equal(decision.action, "ask");
  assert.equal(decision.record?.raised_by, undefined);
  assert.equal(decision.grant_prefix, ".\\Release\\example.exe check");
  assert.ok(decision.pins.some((pin) => pin.path.endsWith("example.exe") && pin.sha256));
  const facts = (stub.calls[0]?.parts.at(-1)?.text ?? "").split("TARGET FACTS:\n")[1]?.split("\n") ?? [];
  assert.match(facts[0] ?? "", /^started \.\\Release\\example\.exe: .*example\.exe, native executable, 1350000 bytes, created in this chat at /);
  assert.match(facts[1] ?? "", /^out\.txt: .*out\.txt, does not exist$/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("every failure becomes a review with its failure kind and never runs", async () => {
  const cases: [Error | string, ReviewFailure][] = [
    [new ModelError("provider_unavailable", "offline"), "network"],
    [new ModelError("provider_unavailable", "502", 502), "provider"],
    [new ModelError("rate_limited", "slow", 429), "rate_limited"],
    [new ModelError("auth", "no key", 401), "auth"],
    [new ModelError("credits", "empty", 402), "credits"],
    [new ModelError("policy", "refused", 403), "refused"],
    [new ModelError("context_limit", "too long"), "too_large"],
    ["not json at all", "unreadable"],
    [answer("allow", "x", { workaround_of: "d1" }), "unreadable"],
  ];
  for (const [reply, failure] of cases) {
    const decision = await decide_command(input("auto", "cargo build"), review_stub([reply]), signal());
    assert.equal(decision.action, "ask", failure);
    assert.equal(decision.record?.source, "unavailable", failure);
    assert.equal(decision.record?.failure, failure, failure);
    assert.equal(decision.record?.reason, "");
    assert.equal(decision.grant_prefix, null);
  }
});

test("after a timeout the next review asks the reviewer again, and an abort rethrows", async () => {
  const chat_id = "decide-timeout";
  const first = review_stub([new ModelError("timeout", "slow")]);
  const timed_out = await decide_command(input("auto", "cargo build", { chat_id }), first, signal());
  assert.equal(timed_out.action, "ask");
  assert.equal(timed_out.record?.failure, "timeout");
  assert.equal(timed_out.note?.failure, "timeout");
  const again = review_stub([answer("allow")]);
  const next = await decide_command(input("auto", "cargo build", { chat_id }), again, signal());
  assert.equal(next.action, "run");
  assert.equal(next.record?.failure, undefined);
  assert.equal(again.calls.length, 1);
  clear_review_chat(chat_id);
  const controller = new AbortController();
  const aborting = review_stub([]);
  aborting.call = async () => {
    controller.abort(new Error("turn stopped"));
    throw new Error("aborted");
  };
  await assert.rejects(decide_command(input("auto", "cargo test"), aborting, controller.signal), /aborted/);
  assert.equal(aborting.records.length, 0);
});

test("a request over the cap is a review with failure too_large and no call", async () => {
  const stub = review_stub([answer("allow")]);
  const decision = await decide_command(input("auto", `echo ${"x".repeat(450000)}`), stub, signal());
  assert.equal(decision.record?.failure, "too_large");
  assert.equal(stub.calls.length, 0);
});

test("scripts reach the request whole, secret files stay unread, and the summary goes to every sent file", async () => {
  const root = await temp_project({ "tool.py": "import shutil\nshutil.rmtree('C:/data')\n", "helper.ps1": "Write-Output hi\n", "secrets.py": "TOKEN = 'abc'\n" });
  const stub = review_stub([answer("review", "deletes outside", { script_summary: `Deletes C:/data\nentirely ${"z".repeat(300)}` }), answer("allow")]);
  const decision = await decide_command(input("auto", "python tool.py --go; .\\helper.ps1", { project_root: root, cwd: root }), stub, signal());
  const current = stub.calls[0]?.parts.at(-1)?.text ?? "";
  assert.match(current, /SCRIPTS RUN BY THIS ACTION:\n----- BEGIN FILE tool\.py \(id s1, started[\s\S]*shutil\.rmtree/);
  const summaries = decision.record?.scripts?.map((script) => script.summary) ?? [];
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((summary) => summary?.startsWith("Deletes C:/data entirely z") && summary.length === 200));
  await decide_command(input("auto", "python secrets.py", { project_root: root, cwd: root }), stub, signal());
  assert.doesNotMatch(stub.calls[1]?.parts.map((part) => part.text).join("") ?? "", /TOKEN/);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a script with a destructive system operation stays a review until that pinned version was approved", async () => {
  const root = await temp_project({ "cleanup.ps1": `Write-Output 'cleaning'\nRemove-Item ${windows_dir}\\Temp -Recurse -Force\n` });
  const first = await decide_command(input("auto", ".\\cleanup.ps1", { project_root: root, cwd: root }), review_stub([answer("allow")]), signal());
  assert.equal(first.action, "ask");
  assert.deepEqual(first.record?.raised_by, ["script_floor"]);
  assert.equal(first.note?.script_floor?.length, 1);
  const approved: HumanDecision = { ...prefix_approval("x", ".\\cleanup.ps1"), grant: "once", grant_prefix: undefined, source_hash: first.source_hash };
  const after = await decide_command(input("auto", ".\\cleanup.ps1", { project_root: root, cwd: root, decisions: [approved] }), review_stub([answer("allow")]), signal());
  assert.equal(after.action, "run");
  await fs.writeFile(path.join(root, "cleanup.ps1"), `Remove-Item ${windows_dir}\\Logs -Recurse -Force\n`);
  const changed = await decide_command(input("auto", ".\\cleanup.ps1", { project_root: root, cwd: root, decisions: [approved] }), review_stub([answer("allow")]), signal());
  assert.deepEqual(changed.record?.raised_by, ["script_floor"]);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a script with an unresolved launch runs on an allow without an earlier approval", async () => {
  const root = await temp_project({ "gap.ps1": "& $env:VX_UNSET_TOOL_FOR_TEST" });
  const stub = review_stub([answer("allow"), answer("review")]);
  const allowed = await decide_command(input("auto", ".\\gap.ps1", { project_root: root, cwd: root }), stub, signal());
  assert.equal(allowed.action, "run");
  assert.equal(allowed.record?.raised_by, undefined);
  assert.match(stub.calls[0]?.parts.at(-1)?.text ?? "", /INSPECTION GAPS:\n.*VX_UNSET_TOOL_FOR_TEST/);
  const asked = await decide_command(input("auto", ".\\gap.ps1", { project_root: root, cwd: root }), stub, signal());
  assert.equal(asked.action, "ask");
  assert.equal(asked.grant_prefix, ".\\gap.ps1");
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a human decision stores the actor id, the review id and the human mark before the answer", () => {
  const note = { id: "r1", source: "model" as const, reason: "x", rule_source: "none" as const, rule: "" };
  const record = human_decision(
    { kind: "command", command: "git push", cwd: "", background: false, review: note, grant_prefix: null },
    { approved: false, grant: "once", feedback: "no" },
    { id: "agent_1", name: "worker", kind: "agent" },
    "u3",
  );
  assert.equal(record.actor, "worker");
  assert.equal(record.actor_id, "agent_1");
  assert.equal(record.review_id, "r1");
  assert.equal(record.last_human_id, "u3");
  assert.equal(record.reason, "x");
});

test("the MCP command gate returns the whole decision", async () => {
  const context = (mode: PermissionMode, answers: string[] = []): ToolContext => ({
    chat_id: `chat-mcp-gate-${mode}`,
    turn_id: "turn",
    call_id: "call",
    project_root: "",
    user_request: "inspect",
    mode,
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal: signal(),
    progress: () => undefined,
    approve: async () => ({ approved: true, grant: "once", feedback: "" }),
    side_model: async () => "",
    review: review_stub(answers),
    message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  });
  assert.equal((await mcp_command_gate("whoami.exe /all", context("full"), [])).action, "run");
  assert.equal((await mcp_command_gate("whoami.exe /all", context("ask"), [])).action, "ask");
  assert.equal((await mcp_command_gate("format c:", context("full"), [])).action, "block");
  const reviewed = await mcp_command_gate("whoami.exe /all", context("auto", [answer("review", "x")]), []);
  assert.equal(reviewed.action, "ask");
  assert.equal(reviewed.note?.reason, "x");
  assert.ok(reviewed.record);
});

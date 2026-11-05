import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode, ToolProgress } from "../shared/chat.ts";
import { init_background, list_background } from "../electron/background/manager.ts";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { shell_tools } from "../electron/tools/shell/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { human_decision } from "../electron/permissions/decisions.ts";
import { answer, main_review_actor, review_stub, type ReviewStub } from "./review-stub.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

let root = "";
const spawned: string[] = [];

const tool = (name: string) => {
  const found = shell_tools.find((entry) => entry.spec.name === name);
  assert.ok(found, name);
  return found;
};

const reviews = () => review_stub(Array.from({ length: 6 }, () => answer("review", "changes files")));

const context = (mode: PermissionMode, decision: ApprovalDecision | null, signal = new AbortController().signal, chat_id = "chat-shell", stub: ReviewStub = reviews()) => {
  const requests: ApprovalRequest[] = [];
  const progress: ToolProgress[] = [];
  const ctx: ToolContext = {
    chat_id,
    turn_id: "turn-shell",
    call_id: "call",
    project_root: root,
    user_request: "run things",
    mode,
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal,
    progress: (entry) => progress.push(entry),
    approve: async (request) => {
      requests.push(request);
      assert.ok(decision, "no approval expected");
      return decision;
    },
    side_model: async () => "",
    review: stub,
    message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
  return { ctx, requests, progress, stub };
};

const run = async (args: Record<string, unknown>, mode: PermissionMode = "full", decision: ApprovalDecision | null = null) => {
  const state = context(mode, decision);
  const result = await tool("run_command").execute(state.ctx, args);
  return { ...state, result };
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tools-shell-"));
  await fs.mkdir(path.join(root, "sub"));
  await init_background({
    data_file: path.join(root, "state", "background.json"),
    spawner: (command) => {
      spawned.push(command);
      return Object.assign(new EventEmitter(), { pid: 9000, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess;
    },
    kill: () => undefined,
    kill_sync: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("run_command runs PowerShell in the project folder and returns UTF-8 output", async () => {
  const { result, progress } = await run({ command: "Write-Output 'hello'; Write-Output 'grüße'; (Get-Location).Path", cwd: "sub" });
  assert.equal(result.status, "done");
  assert.match(result.text, /^exit code 0 after/);
  assert.match(result.text, /hello\r?\ngrüße/);
  assert.match(result.text, /vx-tools-shell-[^\r\n]*[\\/]sub/);
  assert.equal(result.view?.kind === "command" && result.view.cwd, "sub");
  assert.equal(result.view?.kind === "command" && result.view.exit_code, 0);
  assert.equal(progress[0]?.label, "");
});

test("a failing command reports its exit code as a failed step", async () => {
  const { result } = await run({ command: "Write-Error 'broken'; exit 3" });
  assert.equal(result.status, "failed");
  assert.match(result.text, /^exit code 3/);
  assert.match(result.text, /broken/);
});

test("output over the cap per tool result keeps head and tail within the cap, says what is omitted, and the card shows the same text", async () => {
  const { result } = await run({ command: "1..40000 | ForEach-Object { 'row ' + $_.ToString('000000') + ' ' + ('x' * 20) }" });
  assert.equal(result.status, "done");
  assert.ok(estimate_tokens(result.text) <= result_cap_tokens);
  assert.match(result.text, /^exit code 0 after [\d.]+ s\nrow 000001 x/);
  assert.match(result.text, /row 040000 x{20}\s*$/);
  assert.match(result.text, /\n\[output over the 25000-token cap per tool result: \d+ characters omitted here\. Redirect the output to a file and read that file, or filter the output, to see them\.\]\n/);
  const output = result.view?.kind === "command" ? result.view.output : "";
  assert.ok(output.length > 90_000);
  assert.ok(result.text.endsWith(output));
});

test("the timeout stops the command", async () => {
  const { result } = await run({ command: "[System.Threading.Thread]::Sleep(20000)", timeout_ms: 1500 });
  assert.equal(result.status, "failed");
  assert.equal(result.view?.kind === "command" && result.view.timed_out, true);
  assert.match(result.text, /^timed out/);
});

test("aborting the turn kills the command and rejects", async () => {
  const controller = new AbortController();
  const state = context("full", null, controller.signal);
  const started = Date.now();
  setTimeout(() => controller.abort(new Error("turn stopped")), 800);
  await assert.rejects(tool("run_command").execute(state.ctx, { command: "[System.Threading.Thread]::Sleep(30000)" }), /turn stopped/);
  assert.ok(Date.now() - started < 10_000);
});

test("floor commands are blocked without asking", async () => {
  const windows_dir = ["C:", "Windows"].join("\\");
  const { result, requests, stub } = await run({ command: `Remove-Item ${windows_dir} -Recurse` }, "ask", null);
  assert.equal(result.status, "failed");
  assert.match(result.text, /^Blocked \(deleting Windows/);
  assert.equal(result.view?.kind === "command" && result.view.output, "");
  assert.equal(requests.length, 0);
  assert.equal(stub.records[0]?.source, "floor");
});

test("ask mode asks without a prefix option or a review, and a denial runs nothing", async () => {
  const denied = await run({ command: "New-Item -ItemType File marker.txt" }, "ask", { approved: false, grant: "once", feedback: "no" });
  assert.equal(denied.result.status, "denied");
  const request = denied.requests[0];
  assert.equal(request?.kind, "command");
  assert.equal(request?.kind === "command" && request.command, "New-Item -ItemType File marker.txt");
  assert.equal(request?.kind === "command" && request.review, null);
  assert.equal(request?.kind === "command" && request.grant_prefix, null);
  assert.equal(denied.stub.calls.length, 0);
  const prefixed = await run({ command: "git commit -m x" }, "ask", { approved: false, grant: "once", feedback: "" });
  assert.equal(prefixed.requests[0]?.kind === "command" && prefixed.requests[0].grant_prefix, null);
  await assert.rejects(fs.access(path.join(root, "marker.txt")));
});

test("in auto mode a prefix grant lets a later model review of a matching command run without asking", async () => {
  const yes: ApprovalDecision = { approved: true, grant: "prefix", feedback: "" };
  const first = await run({ command: "Write-Output first" }, "auto", yes);
  assert.equal(first.requests[0]?.kind === "command" && first.requests[0].grant_prefix, "Write-Output first");
  assert.equal(first.result.status, "done");
  assert.match(first.result.text, /^The user approved this command\. The approval covers this exact command only\.\nexit code 0/);
  const request = first.requests[0];
  assert.ok(request);
  const again = context("auto", null);
  again.ctx.human_decisions = async () => [human_decision(request, yes, main_review_actor, null)];
  assert.equal((await tool("run_command").execute(again.ctx, { command: "Write-Output first" })).status, "done");
  assert.equal(again.requests.length, 0);
  assert.equal(again.stub.records[0]?.granted, true);
});

test("auto asks the user when the review is unsure and a denial executes nothing", async () => {
  const { requests, result } = await run({ command: "python build.py" }, "auto", { approved: false, grant: "once", feedback: "" });
  assert.equal(result.status, "denied");
  assert.match(result.text, /^The user denied this command\. It did not run\.\nAutomatic review: changes files\nUser feedback: none\./);
  assert.equal(result.view?.kind === "command" && result.view.output, "");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind === "command" ? requests[0].review?.reason : "", "changes files");
});

test("a review deny runs nothing and tells the agent not to work around it", async () => {
  const { ctx, requests, progress } = context("auto", null, undefined, "chat-shell-deny", review_stub([answer("deny", "Downloads were not requested.")]));
  const result = await tool("run_command").execute(ctx, { command: "Write-Output forbidden", cwd: "." });
  assert.equal(result.status, "denied");
  assert.match(result.text, /^Denied by the automatic review\. The command did not run\.\nReason: Downloads were not requested\.\nDo not run it again/);
  assert.equal(result.view?.kind === "command" && result.view.output, "");
  assert.equal(requests.length, 0);
  assert.deepEqual(progress, [{ label: "", lines: null, output_tail: null, phase: "review" }, { label: "", lines: null, output_tail: null }]);
});

test("a script edited between the allow and the run is reviewed again and the first content never runs", async () => {
  await fs.writeFile(path.join(root, "edited.ps1"), "Write-Output first-version");
  const stub = review_stub([]);
  stub.call = async (call) => {
    stub.calls.push(call);
    if (stub.calls.length === 1) await fs.writeFile(path.join(root, "edited.ps1"), "Write-Output second-version");
    return { text: answer("allow"), finish_reason: "stop", usage: null };
  };
  const state = context("auto", null, undefined, "chat-shell-edit", stub);
  const result = await tool("run_command").execute(state.ctx, { command: ".\\edited.ps1" });
  assert.equal(stub.calls.length, 2);
  assert.match(result.text, /second-version/);
  assert.doesNotMatch(result.text, /first-version/);
  assert.equal(stub.records[0]?.superseded, "scripts_changed");
});

test("a card after a script change says the script was reviewed again", async () => {
  await fs.writeFile(path.join(root, "rechecked.ps1"), "Write-Output one");
  const stub = review_stub([]);
  stub.call = async (call) => {
    stub.calls.push(call);
    if (stub.calls.length === 1) await fs.writeFile(path.join(root, "rechecked.ps1"), "Write-Output two");
    return { text: stub.calls.length === 1 ? answer("allow") : answer("review", "changed script"), finish_reason: "stop", usage: null };
  };
  const state = context("auto", { approved: true, grant: "once", feedback: "" }, undefined, "chat-shell-recheck", stub);
  const result = await tool("run_command").execute(state.ctx, { command: ".\\rechecked.ps1" });
  assert.equal(result.status, "done");
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0]?.kind === "command" && state.requests[0].rechecked, true);
});

test("auto asks before a flagged background task, starts nothing after a no and shows the command", async () => {
  const { ctx, requests } = context("auto", { approved: false, grant: "once", feedback: "" });
  const count = spawned.length;
  const result = await tool("start_background_task").execute(ctx, { name: "Rejected", command: "Write-Output forbidden" });
  assert.equal(result.status, "denied");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.kind === "command" && requests[0].background, true);
  assert.equal(spawned.length, count);
  assert.equal(result.view?.kind === "command" && result.view.command, "Write-Output forbidden");
  assert.equal(result.view?.kind === "command" && result.view.output, "");
});

test("normal PowerShell delays follow each permission mode", async () => {
  for (const mode of ["full", "auto", "ask"] as const) {
    const { ctx, requests, stub } = context(mode, { approved: true, grant: "once", feedback: "" }, undefined, "chat-sleep-" + mode, review_stub([answer("allow")]));
    const result = await tool("run_command").execute(ctx, { command: "Start-Sleep -Milliseconds 1; Write-Output ready", cwd: "." });
    assert.equal(result.status, "done");
    assert.match(result.text, /ready/);
    assert.doesNotMatch(result.text, /Tool call rejected/);
    assert.equal(requests.length, mode === "ask" ? 1 : 0);
    assert.equal(stub.calls.length, mode === "auto" ? 1 : 0);
  }
});

test("normal background delays start through the regular task gate", async () => {
  const { ctx, requests } = context("full", null, undefined, "chat-bg-sleep");
  const count = spawned.length;
  const result = await tool("start_background_task").execute(ctx, { name: "Startup", command: "sleep 0.001" });
  assert.equal(result.status, "done");
  assert.equal(requests.length, 0);
  assert.deepEqual(spawned.slice(count), ["sleep 0.001"]);
  const [task] = list_background("chat-bg-sleep");
  assert.ok(task);
  await tool("cancel_background_task").execute(ctx, { id: task.id });
  spawned.splice(count, 1);
});

test("start_background_task is gated like run_command and starts a task", async () => {
  const blocked = await tool("start_background_task").execute(context("full", null).ctx, { name: "wipe", command: "format c:" });
  assert.equal(blocked.status, "failed");
  assert.deepEqual(blocked.view?.kind === "command" && [blocked.view.command, blocked.view.output], ["format c:", ""]);
  const asked = context("ask", { approved: true, grant: "once", feedback: "" }, undefined, "chat-bg");
  const started = await tool("start_background_task").execute(asked.ctx, { name: "Long build", command: "npm run package", cwd: "sub" });
  assert.equal(started.status, "done");
  assert.equal(asked.requests[0]?.kind === "command" && asked.requests[0].background, true);
  assert.deepEqual(spawned, ["npm run package"]);
  const [task] = list_background("chat-bg");
  assert.equal(task?.name, "Long build");
  assert.equal(task?.cwd, "sub");
  const fetched = await tool("get_background_task").execute(asked.ctx, { id: task?.id.slice(0, 12) ?? "" });
  assert.match(fetched.text, /Long build\): running/);
  const cancelled = await tool("cancel_background_task").execute(asked.ctx, { id: task?.id ?? "" });
  assert.match(cancelled.text, /: cancelled/);
  const other_chat = await tool("get_background_task").execute(context("full", null).ctx, { id: task?.id ?? "" });
  assert.equal(other_chat.status, "failed");
});

test("shell tool profiles", () => {
  assert.deepEqual(tool("run_command").profiles, ["main", "plan", "worker"]);
  assert.deepEqual(tool("start_background_task").profiles, ["main"]);
  assert.deepEqual(tool("get_background_task").profiles, ["main", "plan"]);
  assert.deepEqual(tool("cancel_background_task").profiles, ["main"]);
});

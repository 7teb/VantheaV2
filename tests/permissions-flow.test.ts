import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ApprovalDecision, HumanDecision } from "../shared/approval.ts";
import type { AssistantMessage, PermissionMode, ToolStep } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import type { RoundResult } from "../electron/model/types.ts";
import type { ReviewCall, ReviewModelCall, Tool } from "../electron/tools/types.ts";
import { append_message, create_chat, flush_chat, get_chat, init_chats, update_message } from "../electron/chats/store.ts";
import { add_authorization, clear_authorization, set_authorization } from "../electron/permissions/context.ts";
import { chat_decisions, mirror_decision } from "../electron/permissions/decisions.ts";
import { mcp_command_gate } from "../electron/permissions/mcp-gate.ts";
import { agent_review, main_review } from "../electron/permissions/review-records.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";
import { decide as decide_mcp, set_command_gate } from "../electron/tools/mcp/decide.ts";
import { gate_command } from "../electron/tools/shell/gate.ts";
import { create_emitter } from "../electron/turn/emit.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import { answer } from "./review-stub.ts";
import { set_storage_root } from "../electron/storage/paths.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

const model: ModelEntry = { id: "scripted-main", label: "", provider: "", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 100000, max_output: 4096, reasoning_passback: false };

type Frame = { tool: "run_command" | "start_background_task" | "mcp_shell"; command: string };

type Review = { action: string; content: string; lines: Record<string, unknown>[] };

const completed = (over: Partial<RoundResult> = {}): RoundResult => ({ status: "completed", content: "", reasoning: "", reasoning_details: [], tool_calls: [], finish_reason: "stop", usage: null, ...over });

const read_review = (call: ReviewCall): Review => {
  const content = call.parts.map((part) => part.text).join("");
  const action = /----- BEGIN COMMAND \[tag [0-9a-f]+\] -----\n([\s\S]*?)\n----- END COMMAND/.exec(content)?.[1] ?? "";
  const lines = content.split("\n").filter((line) => line.startsWith('{"id":"d')).map((line) => JSON.parse(line) as Record<string, unknown>);
  return { action, content, lines };
};

const fixture = async (t: { after: (fn: () => Promise<void>) => void }, request: string, classifier: (review: Review) => string) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-permission-flow-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "node --test", build: "tsc" } }));
  const options = {
    dirs: { index_file: path.join(root, "index.json"), data_dir: path.join(root, "data"), search_dir: path.join(root, "search") },
    legacy_root: path.join(root, "legacy"),
    events: { changed: () => undefined, removed: () => undefined, appended: () => undefined, truncated: () => undefined, questions: () => undefined },
  };
  await init_chats(options);
  const chat = await create_chat(root);
  const reviews: Review[] = [];
  const executed: string[] = [];
  const asked: string[] = [];
  const answers: ApprovalDecision[] = [];
  let turn = 0;
  await append_message(chat.id, { id: "human-0", role: "user", origin: "user", text: request, attachments: [], created_at: new Date().toISOString() });
  set_authorization(chat.id, (await get_chat(chat.id))!.messages);
  const review_call: ReviewModelCall = async (call) => {
    const review = read_review(call);
    reviews.push(review);
    return { text: classifier(review), finish_reason: "stop", usage: null };
  };
  set_command_gate(mcp_command_gate);
  const tools: Tool[] = (["run_command", "start_background_task", "mcp_shell"] as const).map((name) => ({
    spec: { name, description: "Text-only flow fixture.", parameters: { type: "object", properties: { command: { type: "string" } } } },
    profiles: ["main", "worker"],
    available: () => true,
    execute: async (ctx, args) => {
      const command = String(args.command);
      if (name === "mcp_shell") {
        ctx.execution_cwd = root;
        const verdict = await decide_mcp({ server: "fixture", tool: "shell", tier: "shell_system", args: { command }, scope: null, trusted: true }, ctx, async () => {
          throw new Error("MCP shell must use the command gate");
        });
        if (verdict.kind === "block" || verdict.kind === "denied") {
          return { status: "denied", text: verdict.reason, view: null };
        }
        if (verdict.kind === "ask" && !(await ctx.approve({ kind: "mcp", server: "fixture", tool: "shell", tier: "shell_system", args_preview: command, scope: null })).approved) {
          return { status: "denied", text: "denied", view: null };
        }
      } else {
        const verdict = await gate_command(ctx, command, root, name === "start_background_task");
        if (verdict.kind !== "run") {
          return { status: "denied", text: verdict.kind === "block" ? verdict.reason : verdict.text, view: null };
        }
      }
      executed.push(command);
      return { status: "done", text: "Recorded by the fake executor, nothing was executed.", view: null };
    },
  }));
  const run = async (frames: Frame[], mode: PermissionMode = "auto", agent?: { id: string; name: string; parent_message_id: string; parent_call_id: string }) => {
    const id = `turn-${turn++}`;
    const message: AssistantMessage = {
      id, role: "assistant", model: model.id, effort: "", mode, plan: false, created_at: new Date().toISOString(), ended_at: null,
      status: "streaming", steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0,
    };
    await append_message(chat.id, message);
    const emit = create_emitter(chat.id, id, { update_message, forward: () => undefined, flush: () => undefined });
    let next = 0;
    const review = agent
      ? agent_review({ chat_id: chat.id, agent_id: agent.id, name: agent.name, parent_message_id: agent.parent_message_id, parent_call_id: agent.parent_call_id, live_steps: () => [] }, review_call, model)
      : main_review(chat.id, review_call, model);
    const session: TurnSession = {
      compaction: { audience: "user", facts: async () => "" },
      chat_id: chat.id, message_id: id, user_request: request, project_root: root, settings: { custom_instructions: "" } as Settings,
      model, effort: "", mode, plan: false,
      profile: agent ? "worker" : "main", signal: new AbortController().signal, emit, resolve_tools: () => tools, side_model: async () => "",
      review,
      human_decisions: () => chat_decisions(chat.id),
      ...(agent ? { call_scope: `run-${id}`, mirror_decision: (decision: HumanDecision) => mirror_decision(chat.id, agent.parent_message_id, agent.parent_call_id, decision) } : {}),
      stream: async () => {
        const frame = frames[next++];
        if (!frame) return completed();
        return completed({ finish_reason: "tool_calls", tool_calls: [{ index: 0, id: `p${next}`, name: frame.tool, arguments: JSON.stringify({ command: frame.command }) }] });
      },
      wait_decision: async (call_id) => {
        asked.push(`${id}:${call_id}`);
        return answers.shift() ?? { approved: false, grant: "once", feedback: "" };
      },
    };
    await run_turn_loop(session, [{ role: "system", content: "Scripted main model." }]);
    await flush_chat(chat.id);
    return (await get_chat(chat.id))!.messages.find((entry) => entry.id === id) as AssistantMessage;
  };
  const add_human = (text: string) => {
    add_authorization(chat.id, `human-${text.length}-${turn}`, text, undefined, [], Date.now() + 1);
  };
  t.after(async () => {
    await flush_chat(chat.id);
    clear_authorization(chat.id);
    clear_review_chat(chat.id);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  return { root, chat_id: chat.id, options, reviews, executed, asked, answers, run, add_human };
};

const tool_steps = (message: AssistantMessage) => message.steps.filter((step): step is ToolStep => step.kind === "tool");

const blocking_line = (review: Review, status: string) => review.lines.find((line) => line.status === status && line.human_spoke_since === false);

test("every command is reviewed, a risky step asks once and runs after a yes, and records and the yes survive a restart", async (t) => {
  const f = await fixture(t, "Fix the build of this project.", (review) => (review.action.startsWith("npm install -g") ? answer("review", "installs a tool globally") : answer("allow")));
  f.answers.push({ approved: true, grant: "once", feedback: "" });
  const message = await f.run([
    { tool: "run_command", command: "npm run build" },
    { tool: "run_command", command: "npm install -g typescript" },
    { tool: "run_command", command: "git status" },
  ]);
  assert.deepEqual(f.executed, ["npm run build", "npm install -g typescript", "git status"]);
  assert.equal(f.asked.length, 1);
  assert.deepEqual(f.reviews.map((review) => review.action), ["npm run build", "npm install -g typescript", "git status"]);
  const decided = tool_steps(message).find((step) => step.decisions?.length);
  assert.equal(decided?.args.command, "npm install -g typescript");
  assert.equal(decided?.decisions?.[0]?.approved, true);
  assert.equal(decided?.decisions?.[0]?.reason, "installs a tool globally");
  assert.equal(decided?.decisions?.[0]?.review_id, decided?.reviews?.[0]?.id);
  assert.match(f.reviews[2]?.content ?? "", /"action":"npm install -g typescript","cwd":"[^"]*","status":"approved by the user"/);
  await init_chats(f.options);
  const restored = await chat_decisions(f.chat_id);
  assert.deepEqual(restored.map((entry) => [entry.subject, entry.approved]), [["npm install -g typescript", true]]);
  const stored = (await get_chat(f.chat_id))!.messages.find((entry) => entry.id === message.id) as AssistantMessage;
  assert.deepEqual(tool_steps(stored).map((step) => step.reviews?.[0]?.verdict), ["allow", "review", "allow"]);
});

test("a repeat of a human denial goes to the classifier, a workaround is denied with the stronger text, and a new message lifts the block", async (t) => {
  const f = await fixture(t, "Set up the project.", (review) => {
    const denied = blocking_line(review, "denied by the user");
    if (denied && /-g|global/.test(review.action)) return answer("deny", "Installs globally after the user denied it.", { workaround_of: String(denied.id) });
    return /-g|global/.test(review.action) ? answer("review", "global install") : answer("allow");
  });
  f.answers.push({ approved: false, grant: "once", feedback: "no global installs" });
  await f.run([{ tool: "run_command", command: "npm install -g typescript" }]);
  const repeated = await f.run([{ tool: "start_background_task", command: "npm i --location=global typescript" }]);
  assert.equal(f.reviews.length, 2);
  assert.equal(f.asked.length, 1);
  const variant = f.reviews[1]?.content ?? "";
  assert.match(variant, /"action":"npm install -g typescript".*"status":"denied by the user".*"feedback":"no global installs","human_spoke_since":false/);
  assert.match(variant, /runs in background: yes/);
  assert.match(tool_steps(repeated)[0]?.result_text ?? "", /^Denied by the automatic review as a workaround\. The command did not run\.\nIt reaches the result of an earlier action that the user denied: npm install -g typescript\n/);
  assert.ok(tool_steps(repeated)[0]?.reviews?.[0]?.circumvents);
  assert.deepEqual(tool_steps(repeated)[0]?.reviews?.[0]?.earlier, { action: "npm install -g typescript", status: "user_denied", agent: null });
  f.add_human("ok, maybe it is fine now");
  await f.run([{ tool: "run_command", command: "npm install -g typescript" }]);
  assert.equal(f.asked.length, 2);
  assert.match(f.reviews.at(-1)?.content ?? "", /"status":"denied by the user".*"human_spoke_since":true/);
  assert.deepEqual(f.executed, []);
});

test("an approval answer counts as the human speaking since an earlier denial", async (t) => {
  const f = await fixture(t, "Set up the project.", (review) => (review.action.startsWith("git push") || review.action.startsWith("npm publish") ? answer("review", "publishes") : answer("allow")));
  f.answers.push({ approved: false, grant: "once", feedback: "not yet" }, { approved: true, grant: "once", feedback: "" });
  await f.run([{ tool: "run_command", command: "git push origin main" }, { tool: "run_command", command: "npm publish" }, { tool: "run_command", command: "git status" }]);
  assert.match(f.reviews[1]?.content ?? "", /"action":"git push origin main".*"human_spoke_since":false/);
  assert.match(f.reviews[2]?.content ?? "", /"action":"git push origin main".*"human_spoke_since":true/);
});

test("a card settled by opening the full window is recorded as approved and stops blocking later reviews", async (t) => {
  const f = await fixture(t, "Set up the project.", (review) => (review.action.startsWith("npm install -g") ? answer("review", "installs a tool globally") : answer("allow")));
  f.answers.push({ approved: true, grant: "full_window", feedback: "" });
  const message = await f.run([{ tool: "run_command", command: "npm install -g typescript" }, { tool: "run_command", command: "git status" }]);
  assert.deepEqual(f.executed, ["npm install -g typescript", "git status"]);
  const settled = tool_steps(message)[0];
  assert.equal(settled?.decisions?.[0]?.grant, "full_window");
  assert.equal(settled?.decisions?.[0]?.review_id, settled?.reviews?.[0]?.id);
  assert.match(f.reviews[1]?.content ?? "", /"action":"npm install -g typescript".*"status":"approved by the user"/);
  assert.equal(f.reviews[1]?.lines.some((line) => line.status === "not answered"), false);
});

test("a \"don't ask again\" prefix turns later reviews of that prefix into runs and survives a restart", async (t) => {
  const f = await fixture(t, "Clean up the lint errors.", () => answer("review", "unclear"));
  f.answers.push({ approved: true, grant: "prefix", feedback: "" });
  await f.run([
    { tool: "run_command", command: "npm run lint" },
    { tool: "run_command", command: "npm run lint" },
    { tool: "start_background_task", command: "npm run test" },
  ]);
  assert.deepEqual(f.executed, ["npm run lint", "npm run lint", "npm run test"]);
  assert.equal(f.asked.length, 1);
  assert.equal(f.reviews.length, 3);
  await init_chats(f.options);
  await f.run([{ tool: "run_command", command: "npm run build" }]);
  assert.deepEqual(f.executed.at(-1), "npm run build");
  assert.equal(f.asked.length, 1);
  f.answers.push({ approved: false, grant: "once", feedback: "" });
  await f.run([{ tool: "run_command", command: "npm run lint -- --fix" }]);
  assert.equal(f.asked.length, 2);
});

test("a sub-agent's denial and review are stored on its deploy step and shown to the main agent's review", async (t) => {
  const f = await fixture(t, "Investigate the crash.", (review) => (/^(?:Get|Stop)-Process/.test(review.action) ? answer("review", "stops a process") : answer("allow")));
  const parent = await f.run([]);
  const deploy: ToolStep = {
    id: "deploy", round: 0, kind: "tool", index: 0, call_id: "deploy-1", name: "deploy_agent", args: {}, status: "done", progress: null,
    approval: null, view: null, error: null, result_text: "", started_at: 1, ended_at: 2,
  };
  update_message(f.chat_id, parent.id, (message) => (message.role === "assistant" ? { ...message, steps: [deploy] } : message));
  f.answers.push({ approved: false, grant: "once", feedback: "leave the game running" });
  await f.run([{ tool: "run_command", command: "Stop-Process -Name game" }], "auto", { id: "agent_c0ffee01-0000", name: "Crash reader", parent_message_id: parent.id, parent_call_id: "deploy-1" });
  await f.run([{ tool: "mcp_shell", command: "Stop-Process -Id 4242" }]);
  assert.match(f.reviews.at(-1)?.content ?? "", /"by":"Crash reader#c0ffee01".*"status":"denied by the user".*leave the game running/);
  await flush_chat(f.chat_id);
  await init_chats(f.options);
  const stored = (await get_chat(f.chat_id))!.messages.find((entry) => entry.id === parent.id) as AssistantMessage;
  assert.equal(tool_steps(stored)[0]?.decisions?.[0]?.actor, "Crash reader");
  assert.equal(tool_steps(stored)[0]?.reviews?.[0]?.actor.name, "Crash reader");
  assert.deepEqual(f.executed, []);
});

test("destructive system commands never run, not even in full mode or through an MCP shell", async (t) => {
  const f = await fixture(t, "Delete everything you can.", () => answer("allow"));
  const windows_dir = ["C:", "Windows"].join("\\");
  f.answers.push({ approved: true, grant: "once", feedback: "" }, { approved: true, grant: "once", feedback: "" });
  await f.run([{ tool: "run_command", command: `Remove-Item ${windows_dir} -Recurse -Force` }, { tool: "mcp_shell", command: "format c: /q" }], "full");
  await f.run([{ tool: "start_background_task", command: "diskpart /s wipe.txt" }], "auto");
  assert.deepEqual(f.executed, []);
  assert.equal(f.asked.length, 0);
  assert.equal(f.reviews.length, 0);
});

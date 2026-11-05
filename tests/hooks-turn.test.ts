import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Attachment, Message, UserMessage } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import { hook_notice_text, parse_hook_notice, passed_prompts, without_blocked_prompts, type HookNote } from "../shared/hook-notes.ts";
import type { Hook } from "../shared/hooks.ts";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { blocked_tool_text, hook_note_content, with_feedback } from "../electron/hooks/text.ts";
import { prompt_hooks, turn_hooks } from "../electron/hooks/turn-hooks.ts";
import { ModelError } from "../electron/model/errors.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { clear_authorization, human_requests_of } from "../electron/permissions/context.ts";
import { admit_steers, push_steer, register_active, take_steer_active, unregister_active } from "../electron/turn/active.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import { admit_steer } from "../electron/turn/steer-admission.ts";
import { acknowledge_steer, empty_composer, enqueue, queue_of, set_steering, taken_steer_id } from "../src/state/chat-drafts.ts";
import { hook, ps_path, read_stdin, set_hooks, start_settings, temp_root } from "./hooks-kit.ts";
import { completed, ends, harness, make_tool, model, tool_call, transcript, use_media_root, type Harness } from "./turn-loop-harness.ts";

use_media_root();

let root = "";
let project = "";

before(async () => {
  root = await temp_root("turn");
  project = path.join(root, "project");
  await fs.mkdir(project);
  await start_settings(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const only = (...hooks: Hook[]) => set_hooks({ global: hooks, projects: {} });

const hooked = (stream: StreamFn, tools: Parameters<typeof harness>[1] = []): Harness => {
  const h = harness(stream, tools);
  h.session.project_root = project;
  h.session.hooks = turn_hooks({ chat_id: h.session.chat_id, turn_id: h.session.message_id, cwd: project, project_path: "", mode: "auto", plan: false, agent: null, emit: h.session.emit, signal: h.controller.signal });
  return h;
};

const contents = (messages: ApiMessage[]): string[] => messages.flatMap((message) => (typeof message.content === "string" ? [message.content] : []));

const hook_notices = (events: StreamEventBody[]): HookNote[] =>
  events.flatMap((event) => (event.type === "notice" && event.notice === "hook" ? [parse_hook_notice(event.text)].filter((note): note is HookNote => note !== null) : []));

const rounds = (replies: ((messages: ApiMessage[]) => ReturnType<typeof completed>)[]) => {
  const seen: ApiMessage[][] = [];
  const stream: StreamFn = async (request) => {
    seen.push([...request.messages]);
    const reply = replies[seen.length - 1];
    if (!reply) {
      throw new Error(`no reply for round ${seen.length}`);
    }
    return reply(request.messages);
  };
  return { stream, seen };
};

test("a PreToolUse block keeps the tool from running and the turn continues", async () => {
  await only(hook({ matcher: "probe", command: "[Console]::Error.WriteLine('not allowed here'); exit 2" }));
  let executed = 0;
  const probe = make_tool("probe", async () => {
    executed += 1;
    return { status: "done", text: "ran", view: null };
  });
  const { stream, seen } = rounds([() => completed({ tool_calls: [tool_call("probe")] }), () => completed({ content: "skipped it" })]);
  const h = hooked(stream, [probe]);
  await run_turn_loop(h.session, h.messages);
  assert.equal(executed, 0);
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
  assert.equal(step?.kind === "tool" && step.status, "denied");
  assert.equal(step?.kind === "tool" && step.hooks?.[0]?.status, "blocked");
  assert.match(step?.kind === "tool" ? step.result_text : "", /Reason: not allowed here/);
  assert.equal(seen.length, 2);
  assert.ok(contents(seen[1] ?? []).some((text) => text.includes("Blocked by a PreToolUse hook the user set up")));
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("PostToolUse context comes first in the result and the result keeps the cap", async () => {
  const json = `Write-Output '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"formatter changed 3 files"}}'`;
  await only(hook({ event: "PostToolUse", matcher: "probe", command: json }));
  const probe = make_tool("probe", async () => ({ status: "done", text: "line of tool output\n".repeat(20000), view: null }));
  const { stream } = rounds([() => completed({ tool_calls: [tool_call("probe")] }), () => completed({ content: "ok" })]);
  const h = hooked(stream, [probe]);
  await run_turn_loop(h.session, h.messages);
  const step = transcript(h.events).steps.find((entry) => entry.kind === "tool");
  const text = step?.kind === "tool" ? step.result_text : "";
  assert.ok(text.startsWith("Output of a PostToolUse hook the user set up"));
  assert.match(text, /formatter changed 3 files\n\nline of tool output/);
  assert.match(text, /\[truncated: \d+ chars over the \d+-token cap\]$/);
  assert.ok(estimate_tokens(text) <= result_cap_tokens + 40);
  assert.equal(step?.kind === "tool" && step.hooks?.[0]?.status, "context");
  assert.equal(ends(h.events).length, 1);
});

test("a Stop block runs one more round and the second Stop sees stop_hook_active", async () => {
  const log = path.join(root, "stop-active.txt");
  const command = `${read_stdin}; Add-Content -Path '${ps_path(log)}' -Value $e.stop_hook_active; if (-not $e.stop_hook_active) { [Console]::Error.WriteLine('run the tests first'); exit 2 }`;
  await only(hook({ event: "Stop", command }));
  const { stream, seen } = rounds([() => completed({ content: "finished" }), () => completed({ content: "tests ran" })]);
  const h = hooked(stream);
  await run_turn_loop(h.session, h.messages);
  assert.equal(seen.length, 2);
  assert.ok(contents(seen[1] ?? []).includes("A Stop hook the user set up asked you to continue before ending the turn:\nrun the tests first"));
  assert.deepEqual((await fs.readFile(log, "utf8")).trim().split(/\r?\n/), ["False", "True"]);
  assert.equal(hook_notices(h.events)[0]?.runs[0]?.status, "blocked");
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("a Stop hook that exits 1 lets the turn end with a hook notice", async () => {
  await only(hook({ event: "Stop", command: "[Console]::Error.WriteLine('script broke'); exit 1" }));
  const { stream, seen } = rounds([() => completed({ content: "finished" })]);
  const h = hooked(stream);
  await run_turn_loop(h.session, h.messages);
  assert.equal(seen.length, 1);
  const note = hook_notices(h.events)[0];
  assert.equal(note?.event, "Stop");
  assert.equal(note?.runs[0]?.status, "error");
  assert.equal(note?.runs[0]?.text, "script broke");
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("StopFailure runs before the end of a failed turn and its timeout shows as a notice", async () => {
  await only(hook({ event: "StopFailure", matcher: "rate_limited", command: "Start-Sleep -Seconds 8", timeout_s: 1 }), hook({ event: "StopFailure", matcher: "auth", command: "exit 1" }));
  const h = hooked(async () => {
    throw new ModelError("rate_limited", "slow down");
  });
  await run_turn_loop(h.session, h.messages);
  const notice = h.events.findIndex((event) => event.type === "notice" && event.notice === "hook");
  const end = h.events.findIndex((event) => event.type === "end");
  assert.ok(notice >= 0 && notice < end, `notice at ${notice}, end at ${end}`);
  const note = hook_notices(h.events)[0];
  assert.equal(note?.runs.length, 1);
  assert.equal(note?.runs[0]?.failure, "timeout");
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error: { kind: "rate_limited", message: "slow down" } }]);
});

const photo = (id: string): Attachment => ({ id, kind: "image", name: `${id}.png`, mime: "image/png", size: 1, vision_note: null });

test("a blocked steer reaches no vision note, no human request and no model, and its queued card is acknowledged", async () => {
  await only(hook({ event: "UserPromptSubmit", command: `${read_stdin}; if ($e.prompt -like '*secret*') { [Console]::Error.WriteLine('no secrets in chat'); exit 2 }` }));
  const { stream, seen } = rounds([() => completed({ content: "answered" })]);
  const h = hooked(stream);
  const chat_id = "hooks-steer-gate";
  h.session.chat_id = chat_id;
  const turn = register_active(chat_id, h.session.message_id, h.session.emit, model, "high");
  const described: string[] = [];
  const describe = async (id: string) => {
    described.push(id);
    return "a screenshot";
  };
  const admitted = admit_steers(turn, (steer) => admit_steer({ chat_id, model, signal: h.controller.signal, describe, check: h.session.hooks?.check_steer }, steer));
  h.session.steers = { next: () => turn.steers[0] ?? null, noted: admitted, take: (steer_id) => void take_steer_active(chat_id, steer_id) };
  push_steer(chat_id, "paste the secret token", "s-secret", [photo("secret-shot")]);
  push_steer(chat_id, "also update the readme", "s-readme", [photo("readme-shot")]);
  await Promise.all(turn.steers.map(admitted));
  assert.deepEqual(described, ["readme-shot"]);
  assert.deepEqual(human_requests_of(chat_id).map((entry) => entry.id), ["s-readme"]);
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(h.events.flatMap((event) => (event.type === "steer" ? [event.text] : [])), ["also update the readme"]);
  assert.equal(turn.steers.length, 0);
  assert.deepEqual(described, ["readme-shot"]);
  assert.ok(!contents(seen[0] ?? []).some((text) => text.includes("secret token")));
  const note = hook_notices(h.events)[0];
  assert.equal(note?.prompt, "paste the secret token");
  assert.equal(note?.runs[0]?.text, "no secrets in chat");
  let composer = enqueue(enqueue(empty_composer, chat_id, { id: "q1", text: "paste the secret token", attachments: [], plan: false, steering: false }), chat_id, { id: "q2", text: "also update the readme", attachments: [], plan: false, steering: false });
  composer = set_steering(set_steering(composer, chat_id, "q1", true, "s-secret", "m"), chat_id, "q2", true, "s-readme", "m");
  for (const event of h.events) {
    const steer_id = taken_steer_id(event);
    composer = steer_id ? acknowledge_steer(composer, chat_id, steer_id) : composer;
  }
  assert.deepEqual(queue_of(composer, chat_id), []);
  assert.equal(ends(h.events).length, 1);
  unregister_active(chat_id, h.session.message_id);
  clear_authorization(chat_id);
});

const huge = (word: string) => `${word} `.repeat(30000);

test("hook text sent to the model stays within one result cap", () => {
  const blocks = [huge("first"), huge("second")].map((text) => ({ hook: hook({ command: "exit 2" }), text }));
  const blocked = blocked_tool_text(blocks);
  assert.ok(estimate_tokens(blocked) <= result_cap_tokens + 40, `blocked text has ${estimate_tokens(blocked)} tokens`);
  assert.ok(blocked.startsWith("Blocked by a PreToolUse hook the user set up."));
  assert.match(blocked, /so the user can decide\.$/);
  const runs = blocks.map(({ text }, at) => ({ hook_id: `h${at}`, event: "Stop" as const, shell: "powershell" as const, command: "exit 2", status: "blocked" as const, text, exit_code: 2, duration_ms: 1, failure: null }));
  const note = hook_note_content({ event: "Stop", runs });
  assert.ok(estimate_tokens(note) <= result_cap_tokens + 40, `stop note has ${estimate_tokens(note)} tokens`);
  assert.ok(note.startsWith("A Stop hook the user set up asked you to continue"));
  const output = "exit code 0\nbuild ok";
  const joined = with_feedback(huge("feedback"), output);
  assert.ok(estimate_tokens(joined) <= result_cap_tokens + 40, `feedback result has ${estimate_tokens(joined)} tokens`);
  assert.ok(joined.endsWith(`\n\n${output}`));
  const both = with_feedback(huge("feedback"), huge("output"));
  assert.ok(estimate_tokens(both) <= result_cap_tokens + 40, `feedback and output have ${estimate_tokens(both)} tokens`);
  assert.match(both, /^feedback /);
  assert.match(both, /\n\noutput output /);
});

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-11-03T10:00:00.000Z" });

const assistant = (id: string, over: Partial<AssistantMessage>): AssistantMessage => ({
  id,
  role: "assistant",
  model: model.id,
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-03T10:00:01.000Z",
  ended_at: "2026-11-03T10:00:02.000Z",
  status: "done",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
  ...over,
});

test("a hook-blocked prompt is dropped from the history and context notes replay", async () => {
  const note: HookNote = {
    event: "UserPromptSubmit",
    runs: [{ hook_id: "h1", event: "UserPromptSubmit", shell: "powershell", command: "git branch --show-current", status: "context", text: "main", exit_code: 0, duration_ms: 5, failure: null }],
  };
  const messages: Message[] = [
    user("u1", "the blocked prompt"),
    assistant("a1", { status: "blocked", error: { kind: "hook", message: "PowerShell hook `exit 2`: no" } }),
    user("u2", "the real prompt"),
    assistant("a2", {
      steps: [
        { id: "n1", round: 0, kind: "notice", notice: "hook", text: hook_notice_text(note) },
        { id: "t1", round: 0, kind: "text", text: "the answer" },
      ],
    }),
  ];
  const kept = without_blocked_prompts(messages);
  assert.deepEqual(kept.map((message) => message.id), ["u2", "a2"]);
  const api = await build_api_messages({ system: "s", summary: null, messages: kept, model, agent_tools: false });
  const texts = contents(api);
  assert.ok(!texts.some((text) => text.includes("the blocked prompt")));
  assert.ok(texts.includes(hook_note_content(note)));
  assert.match(hook_note_content(note), /^Output of a UserPromptSubmit hook the user set up \(`git branch --show-current`\):\nmain$/);
  assert.equal(hook_note_content({ ...note, runs: [{ ...note.runs[0]!, status: "error" }] }), "");
});

test("a prompt after hook-blocked prompts is the first passed prompt of the chat", () => {
  const blocked = assistant("a1", { status: "blocked", error: { kind: "hook", message: "PowerShell hook `exit 2`: no" } });
  const streaming = assistant("a2", { status: "streaming", ended_at: null });
  assert.deepEqual(passed_prompts([user("u1", "BLOCKME first"), blocked, user("u2", "second"), streaming]).map((message) => message.id), ["u2"]);
  assert.deepEqual(passed_prompts([user("u1", "first"), assistant("a1", {}), user("u2", "second"), streaming]).map((message) => message.id), ["u1", "u2"]);
});

test("a prompt stopped while its UserPromptSubmit hooks ran never reaches the model", () => {
  const stopped = assistant("a1", { status: "stopped", error: { kind: "hook", message: "stopped before the UserPromptSubmit hooks finished" } });
  const plain_stop = assistant("a3", { status: "stopped" });
  const messages = [user("u1", "unchecked"), stopped, user("u2", "checked"), plain_stop];
  assert.deepEqual(without_blocked_prompts(messages).map((message) => message.id), ["u2", "a3"]);
});

test("UserPromptSubmit runs for messages the user sent and not for turns the app starts", async () => {
  await only(hook({ event: "UserPromptSubmit", command: "[Console]::Error.WriteLine('no'); exit 2" }));
  const h = hooked(rounds([]).stream);
  const identity = { chat_id: h.session.chat_id, turn_id: h.session.message_id, cwd: project, project_path: "", mode: "auto" as const, plan: false, agent: null, emit: h.session.emit, signal: h.controller.signal };
  assert.equal((await prompt_hooks(identity, "hello", "user")).kind, "blocked");
  assert.equal((await prompt_hooks(identity, "/review", "review")).kind, "blocked");
  for (const origin of ["continue", "agent_report", "agent_update", "background", "workflow", "plan_accept", "undo"] as const) {
    assert.deepEqual(await prompt_hooks(identity, "internal", origin), { kind: "go", notes: [] });
  }
});

test("a Stop block cannot keep a turn going after the content filter ended it", async () => {
  await only(hook({ event: "Stop", command: "[Console]::Error.WriteLine('keep going'); exit 2" }));
  const { stream, seen } = rounds([() => completed({ content: "", finish_reason: "content_filter" })]);
  const h = hooked(stream);
  await run_turn_loop(h.session, h.messages);
  assert.equal(seen.length, 1);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

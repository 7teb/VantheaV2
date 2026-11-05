import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Attachment, Message, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { resume_text } from "../electron/context/compact-text.ts";
import type { ApiAssistantMessage, ApiMessage, ApiUserMessage, ApiToolMessage } from "../electron/model/types.ts";
import { init_media, media_path } from "../electron/media/files.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { api_call_id } from "../electron/turn/round.ts";
import { steer_message, steer_prefix } from "../electron/turn/user-input.ts";

let media_root = "";

before(async () => {
  media_root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-history-"));
  init_media({ attachments: path.join(media_root, "attachments"), images: path.join(media_root, "images") });
});

after(async () => {
  await fs.rm(media_root, { recursive: true, force: true });
});

const model = (vision: boolean): ModelEntry => ({
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
});

const image: Attachment = { id: "img_a_b.png", kind: "image", name: "shot.png", mime: "image/png", size: 10, vision_note: "a red button" };

const user = (id: string, text: string, attachments: Attachment[] = []): UserMessage => ({
  id,
  role: "user",
  text,
  attachments,
  origin: "user",
  created_at: "2026-10-06T10:00:00.000Z",
});

const assistant = (id: string, text: string, result: string, call_id: string): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T10:00:01.000Z",
  ended_at: "2026-10-06T10:00:05.000Z",
  status: "done",
  steps: [
    { id: `${id}-t`, round: 0, kind: "text", text },
    {
      id: `${id}-tool`,
      round: 0,
      kind: "tool",
      index: 0,
      call_id,
      name: "read_file",
      args: { path: "x" },
      status: "done",
      progress: null,
      approval: null,
      view: null,
      error: null,
      result_text: result,
      started_at: 1,
      ended_at: 2,
    },
  ],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 3,
});

const fake_image = async () => "data:image/png;base64,AAAA";

test("an image attachment becomes an image part for a vision model", async () => {
  const messages: Message[] = [user("u1", "look", [image])];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: model(true) }, fake_image);
  const user_message = out[1] as ApiUserMessage;
  assert.ok(Array.isArray(user_message.content));
  const parts = user_message.content as Exclude<ApiUserMessage["content"], string>;
  assert.equal(parts.some((part) => part.type === "image_url"), true);
});

test("an image attachment becomes its vision note for a model without vision", async () => {
  const messages: Message[] = [user("u1", "look", [image])];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: model(false) }, fake_image);
  const user_message = out[1] as ApiUserMessage;
  assert.equal(typeof user_message.content, "string");
  assert.match(user_message.content as string, /a red button/);
});

test("an image on a steer step replays as the steer message with its prefix, tag and image part", async () => {
  const steered = assistant("a1", "ok", "content", "c1");
  steered.steps = [{ id: "steer:1", round: 0, kind: "steer", text: "use this", steer_id: "s1", attachments: [image] }, ...steered.steps];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: [user("u1", "go"), steered], model: model(true) }, fake_image);
  const steer = out[2] as ApiUserMessage;
  assert.equal(steer.steer, true);
  assert.deepEqual(steer.content, [
    { type: "text", text: `${steer_prefix}\n\nuse this\n\n<image name="shot.png" id="img_a_b.png" path="${media_path("attachment", "img_a_b.png")}">` },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "text", text: "</image>" },
  ]);
});

test("a replayed steer equals the live steer message byte for byte", async () => {
  for (const vision of [true, false]) {
    const steered = assistant("a1", "ok", "content", "c1");
    steered.steps = [{ id: "steer:1", round: 0, kind: "steer", text: "use this", steer_id: "s1", attachments: [image] }, ...steered.steps];
    const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: [user("u1", "go"), steered], model: model(vision) }, fake_image);
    const live = await steer_message("use this", [image], model(vision), fake_image);
    assert.equal(JSON.stringify(out[2]), JSON.stringify(live));
  }
});

test("a file attachment is a file tag with its id and path so the model can read it", async () => {
  const file: Attachment = { id: "att_x_y.txt", kind: "file", name: "notes.txt", mime: "text/plain", size: 3, vision_note: null };
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: [user("u1", "see", [file])], model: model(true) }, fake_image);
  const user_message = out[1] as ApiUserMessage;
  assert.equal(user_message.content, `see\n\n<file name="notes.txt" id="att_x_y.txt" path="${media_path("attachment", "att_x_y.txt")}" bytes="3" />`);
});

test("a replayed tool result goes out exactly as stored, in old turns as in recent ones", async () => {
  const old = `LOSS-CONTROL-613 ${"x".repeat(120000)} tail-old`;
  const recent = `${"y".repeat(120000)} tail-recent`;
  const messages: Message[] = [
    user("u1", "a"),
    assistant("a1", "one", old, "c_old"),
    user("u2", "b"),
    assistant("a2", "two", "short-a2", "c_a2"),
    user("u3", "c"),
    assistant("a3", "three", recent, "c_a3"),
  ];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: model(false) }, fake_image);
  const tool_messages = out.filter((message): message is ApiToolMessage => message.role === "tool");
  assert.equal(tool_messages.find((message) => message.tool_call_id === api_call_id("a1", "c_old"))?.content, old);
  assert.equal(tool_messages.find((message) => message.tool_call_id === api_call_id("a3", "c_a3"))?.content, recent);
});

const contents = (messages: ApiMessage[]) => messages.map((message) => (typeof message.content === "string" ? message.content : ""));

test("a stored summary from before through_round still loads: note first, then every user message and the recent rounds", async () => {
  const messages: Message[] = [user("u1", "early"), assistant("a1", "one", "r1", "c1"), user("u2", "late")];
  const out = await build_api_messages(
    { system: "sys", agent_tools: true, summary: { text: "earlier work", through_message_id: "a1" }, messages, model: model(false) },
    fake_image,
  );
  assert.deepEqual(contents(out), ["sys", `${resume_text("user")}\n\nearlier work`, "early", "one", "r1", "late"]);
  assert.equal((out[1] as ApiUserMessage).compaction, true);
  assert.equal((out[2] as ApiUserMessage).instruction, true);
});

test("a mid-turn summary splits its message at through_round and puts the harness record after the kept rounds", async () => {
  const running = assistant("a2", "two", "r2", "c2");
  running.status = "streaming";
  running.steps.push(
    { id: "compaction:1", round: 1, kind: "compaction", status: "done", source: "auto" },
    { id: "text:9", round: 1, kind: "text", text: "after" },
  );
  const background: Message = { ...user("u3", "task finished"), origin: "background" };
  const messages: Message[] = [user("u1", "first"), assistant("a1", "one", "r1", "c1"), background, user("u2", "second"), running];
  const summary = { text: "TASK: t", through_message_id: "a2", through_round: 0, facts: "Files changed:\n- a.ts (+1 -0)" };
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary, messages, model: model(false) }, fake_image);
  assert.deepEqual(contents(out), ["sys", `${resume_text("user")}\n\nTASK: t`, "first", "one", "r1", "task finished", "second", "two", "r2", "Files changed:\n- a.ts (+1 -0)", "after"]);
  assert.equal((out.at(-2) as ApiUserMessage).compaction, true);
  assert.equal((out[5] as ApiUserMessage).instruction, undefined);
});

test("replayed tool call ids are unique across turns and provider-safe", async () => {
  const messages: Message[] = [
    user("u1", "a"),
    assistant("0b5f3c1e-aaaa-4bbb-8ccc-111111111111", "one", "r1", "c0_0"),
    user("u2", "b"),
    assistant("7d2e9a40-dddd-4eee-8fff-222222222222", "two", "r2", "c0_0"),
  ];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: model(false) }, fake_image);
  const call_ids = out.flatMap((message) => (message.role === "assistant" ? (message.tool_calls ?? []).map((call) => call.id) : []));
  const result_ids = out.filter((message): message is ApiToolMessage => message.role === "tool").map((message) => message.tool_call_id);
  assert.equal(call_ids.length, 2);
  assert.equal(new Set(call_ids).size, 2);
  assert.deepEqual(result_ids, call_ids);
  assert.ok(call_ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)));
});

test("a passback model gets its own stored reasoning back per round, text when no details were stored", async () => {
  const details = [{ type: "reasoning.text", text: "plan A", format: "unknown", index: 0 }];
  const base = assistant("a1", "one", "r1", "c0_0");
  const reasoned: AssistantMessage = {
    ...base,
    steps: [
      { id: "r0", round: 0, kind: "reasoning", text: "plan A", started_at: 1, ended_at: 2 },
      ...base.steps,
      { id: "r1", round: 1, kind: "reasoning", text: "plan B", started_at: 3, ended_at: 4 },
      { id: "t1", round: 1, kind: "text", text: "done" },
    ],
    reasoning_details: [{ round: 0, details }],
  };
  const messages: Message[] = [user("u1", "go"), reasoned, user("u2", "next")];
  const replay = async (entry: ModelEntry) =>
    (await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: entry }, fake_image))
      .filter((message): message is ApiAssistantMessage => message.role === "assistant")
      .map((message) => [message.reasoning_details, message.reasoning]);
  const passback = { ...model(false), reasoning_passback: true };
  assert.deepEqual(await replay(passback), [
    [details, undefined],
    [undefined, "plan B"],
  ]);
  assert.deepEqual(await replay(model(false)), [
    [undefined, undefined],
    [undefined, undefined],
  ]);
  assert.deepEqual(await replay({ ...passback, id: "other" }), [
    [undefined, undefined],
    [undefined, undefined],
  ]);
});

test("a legacy agent report notice replays as a lookup notification without its inline report", async () => {
  const reported: AssistantMessage = {
    ...assistant("a1", "done", "r1", "c0_0"),
    steps: [
      { id: "notice:1", round: 1, kind: "notice", notice: "agent_report", text: "Reviewer (agent_x) finished with status completed after 5s.\n\nREPORT:\nthe seam is broken" },
      { id: "text:2", round: 1, kind: "text", text: "fixing the seam" },
    ],
  };
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: [user("u1", "go"), reported, user("u2", "next")], model: model(false) }, fake_image);
  const at = out.findIndex((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("get_agent_status"));
  assert.ok(at > 1);
  assert.equal(out[at + 1]?.role, "assistant");
  assert.match(String(out[at]?.content), /Internal app event/);
  assert.doesNotMatch(JSON.stringify(out), /the seam is broken/);
});

test("post-turn report events replay as references without report bodies, status results replay as stored", async () => {
  const event = user("event", "[AGENT REPORT EVENT]\n\nAgent ID: agent_1\n\nRun ID: run_1\n\nName: Scout\n\nModel: m\n\nProfile: explore\n\nStatus: completed\n\nDuration: 2s\n\nReport:\nREPORT_BODY_SENTINEL");
  event.origin = "agent_report";
  const legacy_status = "Agent agent_1. Run run_1: completed.\nReport:\nSTATUS_BODY_SENTINEL";
  const running_status = 'Agent agent_2 ("Scout"), explore, model m. Run run_2: running after 9s.\nTool calls so far: 1. Most recent: read_file.\nLatest output: found it\nReport:\nLOSS-CONTROL-613\nIt is still working; its report arrives automatically when it finishes.';
  const legacy = assistant("a1", "read the file", legacy_status, "c1");
  const running = assistant("a2", "check again", running_status, "c2");
  for (const answer of [legacy, running]) {
    const tool = answer.steps.find((step) => step.kind === "tool");
    assert.ok(tool && tool.kind === "tool");
    tool.name = "get_agent_status";
  }
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: [event, legacy, user("u2", "next"), running, user("u3", "go")], model: model(false) }, fake_image);
  const text = JSON.stringify(out.filter((message) => message.role !== "tool"));
  assert.match(text, /agent_1/);
  assert.match(text, /run_1/);
  assert.match(text, /get_agent_status/);
  assert.doesNotMatch(text, /REPORT_BODY_SENTINEL/);
  const results = out.filter((message): message is ApiToolMessage => message.role === "tool").map((message) => message.content);
  assert.deepEqual(results, [legacy_status, running_status]);
});

test("replayed report notices name continue_agent and get_agent_status only when the turn offers agent tools", async () => {
  const saved: AssistantMessage = {
    ...assistant("a1", "done", "r1", "c0_0"),
    steps: [
      {
        id: "notice:1",
        round: 1,
        kind: "notice",
        notice: "agent_report",
        text: "Reviewer (agent_x) finished with status completed after 5s.\n\nREPORT:\nRun ID: run_1\nReport file: C:\\reports\\agent_x.report.md",
      },
      { id: "text:2", round: 1, kind: "text", text: "reading it" },
    ],
  };
  const lost: AssistantMessage = {
    ...assistant("a2", "done", "r2", "c0_1"),
    steps: [{ id: "notice:3", round: 1, kind: "notice", notice: "agent_report", text: "Reviewer (agent_y) finished with status completed after 5s.\n\nREPORT:\nReport file: unavailable" }],
  };
  const event = user("event", "[AGENT REPORT EVENT]\n\nAgent ID: agent_z\n\nRun ID: run_2\n\nName: Scout\n\nModel: m\n\nProfile: explore\n\nStatus: completed\n\nDuration: 2s\n\nReport:\nReport file: unavailable");
  event.origin = "agent_report";
  const messages: Message[] = [user("u1", "go"), saved, lost, event, user("u2", "next")];
  const replay = async (agent_tools: boolean) =>
    JSON.stringify(await build_api_messages({ system: "sys", agent_tools, summary: null, messages, model: model(false) }, fake_image));
  const without = await replay(false);
  assert.match(without, /agent_x\.report\.md/);
  assert.doesNotMatch(without, /continue_agent|get_agent_status/);
  const with_tools = await replay(true);
  assert.match(with_tools, /continue_agent/);
  assert.match(with_tools, /get_agent_status/);
});

test("a step cancelled while its review card waited replays as not approved", async () => {
  const waited = assistant("a1", "Pushing now.", "", "c0_0");
  const step = waited.steps[1];
  assert.ok(step?.kind === "tool");
  const review = { id: "r1", at: 1, actor: { id: "main", name: "main", kind: "main" as const }, tool: "run_command", subject: "git push", cwd: "", verdict: "review" as const, source: "model" as const, reason: "pushes", rule_source: "none" as const, rule: "", last_human_id: null };
  waited.steps[1] = { ...step, name: "run_command", status: "cancelled", reviews: [review] };
  const messages = await build_api_messages({ system: "s", summary: null, messages: [user("u1", "go"), waited], model: model(false), agent_tools: false });
  const tool_message = messages.find((message): message is ApiToolMessage => message.role === "tool");
  assert.match(tool_message?.content ?? "", /^Not run: the turn was stopped while this command waited for the user's approval\. It is not approved\./);
  waited.steps[1] = { ...step, name: "run_command", status: "cancelled", reviews: [review], decisions: [{ id: "a", at: 2, actor: "main", tool: "run_command", subject: "git push", cwd: "", approved: true, grant: "once", feedback: "", reason: "", review_id: "r1" }] };
  const answered = await build_api_messages({ system: "s", summary: null, messages: [user("u1", "go"), waited], model: model(false), agent_tools: false });
  assert.equal(answered.find((message): message is ApiToolMessage => message.role === "tool")?.content, "[no result]");
});

test("an ask_user call followed by an answer steer replays as the call, its result and then the answer", async () => {
  const answer = 'Answer to your question "Which runner?":\nnode --test';
  const asked: AssistantMessage = {
    ...assistant("a1", "I will ask.", "Shown to the user above the message box.", "c0_0"),
    steps: [
      { id: "a1-t", round: 0, kind: "text", text: "I will ask." },
      {
        id: "a1-tool",
        round: 0,
        kind: "tool",
        index: 0,
        call_id: "c0_0",
        name: "ask_user",
        args: { questions: [{ title: "Which runner?", options: ["node --test"] }] },
        status: "done",
        progress: null,
        approval: null,
        view: { kind: "questions", questions: [{ title: "Which runner?", options: ["node --test"] }] },
        error: null,
        result_text: "Shown to the user above the message box.",
        started_at: 1,
        ended_at: 2,
      },
      { id: "a1-s", round: 1, kind: "steer", text: answer, steer_id: "s1" },
      { id: "a1-t2", round: 1, kind: "text", text: "Using node --test." },
    ],
  };
  const out = await build_api_messages({ system: "sys", agent_tools: false, summary: null, messages: [user("u1", "go"), asked], model: model(false) }, fake_image);
  assert.deepEqual(
    out.slice(2).map((message) => message.role),
    ["assistant", "tool", "user", "assistant"],
  );
  const call = out[2] as ApiAssistantMessage;
  assert.equal(call.tool_calls?.[0]?.function.name, "ask_user");
  assert.equal(call.tool_calls?.[0]?.id, api_call_id("a1", "c0_0"));
  assert.equal((out[3] as ApiToolMessage).content, "Shown to the user above the message box.");
  assert.equal((out[4] as ApiUserMessage).content, `${steer_prefix}\n\n${answer}`);
  assert.equal((out[4] as ApiUserMessage).steer, true);
  assert.equal((out[5] as ApiAssistantMessage).content, "Using node --test.");
});

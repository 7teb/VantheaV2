import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, ChatSummary, Message, Step, UserMessage, UserOrigin } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { build_api_messages } from "../electron/turn/history.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 128_000,
  max_output: 4096,
  reasoning_passback: false,
};

const prompt = "Check how hot it gets in Mali today.";

const user = (id: string, origin: UserOrigin): UserMessage => ({ id, role: "user", text: prompt, attachments: [], origin, created_at: "2026-11-04T10:00:00.000Z" });

const assistant = (id: string, steps: Step[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-11-04T10:00:01.000Z",
  ended_at: "2026-11-04T10:00:05.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
});

const answer = (index: number): Step[] => [{ id: `text:${index}`, round: 0, kind: "text", text: `run ${index}: 41 degrees` }];

const runs = (count: number, origin: UserOrigin): Message[] => Array.from({ length: count }, (_, index) => [user(`u${index + 1}`, origin), assistant(`a${index + 1}`, answer(index + 1))]).flat();

const copies = (messages: ApiMessage[]) => messages.filter((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt)).length;

test("earlier scheduled prompts are not kept as instructions past the window cut", async () => {
  const summary: ChatSummary = { text: "TASK: watch the heat", through_message_id: "a290", facts: "" };
  const scheduled = await build_api_messages({ system: "sys", summary, messages: runs(300, "scheduled"), model, agent_tools: false });
  const background = await build_api_messages({ system: "sys", summary, messages: runs(300, "background"), model, agent_tools: false });
  assert.equal(copies(scheduled), copies(background));
  assert.ok(copies(scheduled) <= 20, String(copies(scheduled)));
  assert.equal(scheduled.filter((message) => message.role === "user" && message.instruction).length, 1);
});

test("the newest scheduled prompt survives a compaction cut inside its own run", async () => {
  const long_run: Step[] = Array.from({ length: 14 }, (_, round) => ({ id: `text:${round}`, round, kind: "text", text: `step ${round}` }));
  const messages: Message[] = [...runs(3, "scheduled"), user("u4", "scheduled"), assistant("a4", long_run)];
  const summary: ChatSummary = { text: "TASK: watch the heat", through_message_id: "a4", through_round: 12, facts: "" };
  const out = await build_api_messages({ system: "sys", summary, messages, model, agent_tools: false });
  const kept = out.filter((message) => message.role === "user" && JSON.stringify(message.content).includes(prompt));
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.role === "user" && kept[0].instruction, true);
  assert.ok(out.some((message) => message.role === "assistant" && message.content === "step 13"));
  assert.ok(!out.some((message) => message.role === "assistant" && message.content === "step 0"));
});

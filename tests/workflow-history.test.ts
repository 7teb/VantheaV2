import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { joins_turn } from "../shared/turn-span.ts";
import { build_api_messages } from "../electron/turn/history.ts";

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1_000_000, max_output: 4096, reasoning_passback: false };

const notice = "[WORKFLOW RESULT EVENT]\nWorkflow w (run wf_00000000-0001) ended with status completed after 3s.";

const assistant = (id: string, steps: AssistantMessage["steps"]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T10:00:00.000Z",
  ended_at: "2026-10-06T10:00:01.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
});

test("a workflow result that started a turn or arrived inside one replays as an internal app event", async () => {
  const user: UserMessage = { id: "u1", role: "user", text: "review it", attachments: [], origin: "user", created_at: "2026-10-06T10:00:00.000Z" };
  const event: UserMessage = { id: "u2", role: "user", text: notice, attachments: [], origin: "workflow", created_at: "2026-10-06T10:00:02.000Z" };
  const messages = [
    user,
    assistant("a1", [
      { id: "t1", round: 0, kind: "text", text: "Waiting for the workflow." },
      { id: "n1", round: 1, kind: "notice", notice: "workflow_result", text: notice },
      { id: "t2", round: 1, kind: "text", text: "Done." },
    ]),
    event,
    assistant("a2", [{ id: "t3", round: 0, kind: "text", text: "Read it." }]),
  ];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model }, async () => "");
  const framed = out.filter((message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith("[Internal app event, not a user message. A workflow you started ended."));
  assert.equal(framed.length, 2);
  assert.ok(framed.every((message) => typeof message.content === "string" && message.content.endsWith(notice)));
  assert.ok(!out.some((message) => message.role === "user" && message.content === notice), "the raw notice never reaches the model unframed");
  const event_message = out.find((message) => message.role === "user" && typeof message.content === "string" && message.content.endsWith(notice) && !("instruction" in message && message.instruction));
  assert.ok(event_message);
  assert.equal(joins_turn("workflow"), true);
});

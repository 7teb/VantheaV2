import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, Step, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";

const model: ModelEntry = {
  id: "deepseek/deepseek-v4.1-flash-1017",
  label: "DeepSeek V4.1 Flash",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const user = (id: string): UserMessage => ({ id, role: "user", text: "build it", attachments: [], origin: "user", created_at: "2026-11-02T10:00:00.000Z" });

const assistant = (id: string, steps: Step[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: model.id,
  effort: "high",
  status: "done",
  steps,
  created_at: "2026-11-02T10:00:01.000Z",
} as AssistantMessage);

test("a background task note taken mid-turn is replayed to the model in its place and never shows in the chat", async () => {
  const text = "[BACKGROUND TASK EVENT]\n\nThis is an internal app event, not a message written by the user. A long-running task you started earlier in this chat has finished.\n\nCommand: npm run build";
  const before: Step = { id: "text:1", round: 0, kind: "text", text: "Building in the background." };
  const notice: Step = { id: "notice:2", round: 1, kind: "notice", notice: "background_task", text };
  const after: Step = { id: "text:3", round: 1, kind: "text", text: "The build finished." };
  const messages: Message[] = [user("u1"), assistant("a1", [before, notice, after])];
  const api = await build_api_messages({ system: "sys", summary: null, messages, model, agent_tools: false });
  const contents = api.map((item) => (typeof item.content === "string" ? item.content : null));
  const at = contents.indexOf(text);
  assert.ok(at > 0, JSON.stringify(contents));
  assert.equal(api[at].role, "user");
  assert.equal(api[at - 1]?.role, "assistant");
  assert.equal(api[at + 1]?.role, "assistant");
  assert.deepEqual(build_blocks([before, notice, after]).map((block) => block.kind), ["text", "text"]);
});

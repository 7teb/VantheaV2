import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, Step, ToolStep, UserMessage } from "../shared/chat.ts";
import { build_blocks, last_own_send } from "../src/features/chat/assistant-blocks.ts";

const tool = (index: number, name: string): ToolStep => ({
  id: `tool:1:${index}`,
  round: 1,
  kind: "tool",
  index,
  call_id: `c${index}`,
  name,
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "ok",
  started_at: 1,
  ended_at: 2,
});

test("read_attachment steps never reach the worklog", () => {
  const steps: Step[] = [tool(0, "read_attachment"), { id: "text:1", round: 1, kind: "text", text: "hi" }, tool(1, "read_file"), tool(2, "read_attachment"), tool(3, "grep_files")];
  const blocks = build_blocks(steps);
  assert.deepEqual(
    blocks.map((block) => (block.kind === "work" ? block.steps.map((step) => (step.kind === "tool" ? step.name : step.kind)).join(",") : block.kind)),
    ["text", "read_file,grep_files"],
  );
  assert.deepEqual(build_blocks([tool(0, "read_attachment")]), []);
});

const user = (id: string, origin: UserMessage["origin"]): UserMessage => ({ id, role: "user", text: "", attachments: [], origin, created_at: "2026-10-06T00:00:00.000Z" });

const assistant = (id: string): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "ask",
  plan: false,
  created_at: "2026-10-06T00:00:00.000Z",
  ended_at: null,
  status: "done",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

test("only the user's own sends move the follow key, not messages main appends", () => {
  const sent: Message[] = [user("u1", "user"), assistant("a1")];
  assert.equal(last_own_send(sent), "u1");
  assert.equal(last_own_send([...sent, user("u2", "background"), assistant("a2")]), "u1");
  assert.equal(last_own_send([...sent, user("u3", "agent_report"), assistant("a3")]), "u1");
  assert.equal(last_own_send([...sent, user("u6", "agent_update"), assistant("a6")]), "u1");
  assert.equal(last_own_send([...sent, user("u7", "scheduled"), assistant("a7")]), "u1");
  assert.equal(last_own_send([...sent, user("u4", "continue")]), "u4");
  assert.equal(last_own_send([...sent, user("u5", "plan_accept")]), "u5");
  assert.equal(last_own_send([]), "");
});

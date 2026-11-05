import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_agent_notice, report_event_text, update_event_text } from "../shared/agent-notes.ts";
import type { AssistantMessage, Message, ToolStep, UserMessage } from "../shared/chat.ts";
import { peer_alert_text } from "../shared/peer-notes.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { turn_layout } from "../src/features/chat/origin-steps.ts";

const tool = (id: string): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${id}`,
  name: "read_file",
  args: { path: "src/a.ts" },
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "ok",
  started_at: 1,
  ended_at: 2,
});

const assistant = (id: string, steps: AssistantMessage["steps"]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "deepseek/deepseek-v4.1-flash-1017",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-29T10:00:00.000Z",
  ended_at: "2026-10-29T10:01:00.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const origin = (id: string, origin_kind: UserMessage["origin"], text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: origin_kind, created_at: "2026-10-29T10:00:30.000Z" });

const update = (id: string, name: string) => origin(id, "agent_update", update_event_text({ agent_id: `agent_${name}`, run_id: "run_1", name, text: `${name} found the parser entry point` }));

test("an update that started its own turn joins the tool group of that turn", () => {
  const messages: Message[] = [assistant("a-1", [tool("t1"), tool("t2")]), update("u-1", "Scout"), assistant("a-2", [tool("t3"), tool("t4")])];
  const layout = turn_layout(messages);
  assert.deepEqual([...layout.absorbed], ["u-1"]);
  const lead = layout.lead.get("a-2") ?? [];
  assert.equal(lead.length, 1);
  assert.equal(lead[0]?.notice, "agent_update");
  assert.deepEqual(parse_agent_notice(lead[0]?.text ?? ""), { kind: "update", name: "Scout", agent_id: "agent_Scout", status: "running", seconds: null, body: "Scout found the parser entry point" });
  const blocks = build_blocks([...lead, ...(messages[2] as AssistantMessage).steps]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "work");
  assert.deepEqual(blocks[0]?.kind === "work" ? blocks[0].steps.map((step) => step.id) : [], ["origin:u-1:0", "t3", "t4"]);
});

test("a report turn joins too and keeps the agent's status", () => {
  const text = report_event_text({ agent_id: "agent_Fixer", run_id: "run_2", name: "Fixer", model: "m", profile: "worker", status: "failed", seconds: 75, report_path: "D:/r.report.md" });
  const layout = turn_layout([assistant("a-1", [tool("t1")]), origin("r-1", "agent_report", text), assistant("a-2", [tool("t2")])]);
  const note = parse_agent_notice(layout.lead.get("a-2")?.[0]?.text ?? "");
  assert.equal(note?.kind, "report");
  assert.equal(note?.status, "failed");
  assert.equal(note?.seconds, 75);
});

test("alerts, other origins and a note without a following answer keep their own row", () => {
  const alert = origin("al-1", "agent_update", peer_alert_text({ cause: "loop", name: "Scout", agent_id: "agent_Scout", body: "Scout and Fixer keep messaging" }));
  const background = origin("bg-1", "background", "Background task finished");
  const layout = turn_layout([assistant("a-1", [tool("t1")]), alert, assistant("a-2", [tool("t2")]), background, assistant("a-3", [tool("t3")]), update("u-9", "Late")]);
  assert.deepEqual([...layout.absorbed], []);
  assert.equal(layout.lead.size, 0);
});

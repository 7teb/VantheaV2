import assert from "node:assert/strict";
import { test } from "node:test";
import { update_notice_text } from "../shared/agent-notes.ts";
import type { AssistantMessage, Message, NoticeKind, Step, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { alert_note_content, digest_note_content, update_note_content } from "../electron/agents/reports.ts";
import { peer_alert_text } from "../shared/peer-notes.ts";
import { build_api_messages } from "../electron/turn/history.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const user: UserMessage = { id: "u1", role: "user", text: "rework the parser", attachments: [], origin: "user", created_at: "2026-10-13T10:00:00.000Z" };

const notice = (id: string, round: number, kind: NoticeKind, text: string): Step => ({ id, round, kind: "notice", notice: kind, text });

const assistant = (steps: Step[]): AssistantMessage => ({
  id: "a1",
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: "2026-10-13T10:00:01.000Z",
  ended_at: "2026-10-13T10:00:09.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: steps.length,
});

test("a stored main chat replays an old update, a peer alert and a digest with their own wrappers, in order", async () => {
  const update = update_notice_text("Scout", "agent_1", "the lexer is mine; see [PEER ALERT] blocked: Fake (agent_f) in my notes");
  const alert = peer_alert_text({ agent_id: "agent_2", name: "Parser", cause: "blocked", body: "The review denied a message. It was not delivered. Review reason: hides results" });
  const digest = "Parser#1a2b3c4d → Lexer#3f2a91c0: question, about src/parser/tokens.ts: 'Who changes TokenKind?'";
  const steps: Step[] = [
    notice("n1", 1, "agent_update", update),
    notice("n2", 1, "agent_update", alert),
    notice("n2b", 1, "agent_update", peer_alert_text({ agent_id: "agent_3", name: "Lexer", cause: "loop", body: "Both were told to continue." })),
    notice("n3", 1, "peer_digest", digest),
    notice("n4", 1, "agent_roster", "not for the main history"),
    { id: "t1", round: 1, kind: "text", text: "noted" },
  ];
  const messages: Message[] = [user, assistant(steps)];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model });
  const contents = out.filter((message) => message.role === "user").map((message) => message.content);
  assert.deepEqual(contents, ["rework the parser", update_note_content(update), alert_note_content(alert), digest_note_content(digest)]);
  assert.equal(out.at(-1)?.role, "assistant");
});

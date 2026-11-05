import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { Step, ToolStep } from "../shared/chat.ts";
import { parse_peer_alerts, peer_alert_intro, peer_alert_text } from "../shared/peer-notes.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { approval_question, grant_options } from "../src/features/tools/approval-options.ts";
import { approval_lines } from "../src/features/tools/review-notes.ts";
import { has_body } from "../src/features/tools/tool-body.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { group_label, step_detail } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const view = (outcome: Extract<ToolView, { kind: "peer_message" }>["outcome"]): ToolView => ({
  kind: "peer_message",
  message_id: "msg_1",
  to_name: "Lexer",
  to_id: "agent_3f2a91c0",
  type: "question",
  about: "src/parser/tokens.ts",
  summary: "Who changes TokenKind?",
  outcome,
});

const step = (name: string, tool_view: ToolView | null, status: ToolStep["status"] = "done", args: Record<string, unknown> = {}): ToolStep => ({
  id: `tool:${name}:${status}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status,
  progress: null,
  approval: null,
  view: tool_view,
  error: null,
  result_text: "",
  started_at: null,
  ended_at: null,
});

test("a message_peer row names the recipient, shows only a failed delivery and never opens", () => {
  assert.equal(tool_label(t, step("message_peer", null, "running", { to: "Lexer#3f2a91c0" })), "Messaging Lexer#3f2a91c0");
  assert.equal(tool_label(t, step("message_peer", view("queued"))), "Messaged Lexer");
  assert.equal(tool_label(de, step("message_peer", view("queued"))), "Lexer benachrichtigt");
  assert.equal(step_detail(t, step("message_peer", view("queued"))), "");
  assert.equal(step_detail(t, step("message_peer", view("held"))), "");
  assert.equal(step_detail(t, step("message_peer", view("denied"))), "");
  assert.equal(step_detail(t, step("message_peer", view("duplicate"))), "Already sent");
  assert.equal(step_detail(de, step("message_peer", view("not_running"))), "Läuft nicht");
  assert.equal(has_body(t, step("message_peer", view("queued"))), false);
  assert.equal(has_body(t, step("message_main_agent", { kind: "text", text: "found it" })), false);
  assert.equal(group_label(t, [step("message_peer", view("queued")), step("message_main_agent", null)]), "Sent 2 messages");
  assert.equal(tool_label(t, step("list_agents", { kind: "text", text: "Agents in this chat" })), "Listed agents");
});

test("an agent text card asks per tool, offers only a single approval and shows the review reason", () => {
  const request = (tool: Extract<ApprovalRequest, { kind: "agent_message" }>["tool"]): ApprovalRequest => ({
    kind: "agent_message",
    tool,
    to_name: "Lexer#3f2a91c0",
    to_id: tool === "deploy_agent" ? null : "agent_3f2a91c0",
    about: "parser",
    text: "Split tokens.ts and lexer.ts.",
    review: { id: "r1", source: "model", reason: "Unclear whether the user wants a second agent.", rule_source: "none", rule: "" },
  });
  const question = (tool: Parameters<typeof request>[0]) => {
    const asked = approval_question(request(tool));
    return t(asked.key, asked.vars);
  };
  assert.equal(question("message_peer"), "May I send this message to Lexer#3f2a91c0?");
  assert.equal(question("message_agent"), "May I send this message to Lexer#3f2a91c0?");
  assert.equal(question("deploy_agent"), "May I start the agent Lexer#3f2a91c0 with this task?");
  assert.equal(question("continue_agent"), "May I continue Lexer#3f2a91c0 with this task?");
  assert.deepEqual(grant_options(request("message_peer")).map((option) => option.grant), ["once"]);
  assert.deepEqual(approval_lines(t, request("message_peer")).map((line) => line.text), ["Automatic review: Unclear whether the user wants a second agent."]);
});

test("peer digests, roster notices and update reminders never render, while messages and statuses join the work group", () => {
  const notice = (id: string, kind: "peer_digest" | "peer_message" | "peer_status" | "agent_roster" | "update_reminder"): Step => ({ id, round: 1, kind: "notice", notice: kind, text: id });
  const steps: Step[] = [step("read_file", null), notice("d", "peer_digest"), notice("u", "update_reminder"), step("grep_files", null), notice("m", "peer_message"), notice("s", "peer_status"), notice("r", "agent_roster")];
  const blocks = build_blocks(steps);
  assert.deepEqual(blocks.map((block) => block.kind), ["work"]);
  assert.deepEqual(blocks[0]?.kind === "work" ? blocks[0].steps.map((entry) => entry.id) : [], [steps[0]?.id, steps[3]?.id, "m", "s"]);
});

test("a blocked peer alert parses into an alert note, also inside an internal turn text with other events, and an old loop alert parses to nothing", () => {
  const text = peer_alert_text({ cause: "blocked", name: "Parser", agent_id: "agent_1a2b", body: "The review denied a message." });
  const event = `${peer_alert_intro}\n\n${text}\n\n[AGENT UPDATE EVENT]\n\nAgent ID: agent_x`;
  assert.deepEqual(
    parse_peer_alerts(event).map((note) => [note.kind, note.status, note.name, note.agent_id, note.body]),
    [["alert", "blocked", "Parser", "agent_1a2b", "The review denied a message."]],
  );
  const loop = peer_alert_text({ cause: "loop", name: "Parser", agent_id: "agent_1a2b", body: "Parser#1a2b and Lexer#3f2a sent each other two messages." });
  assert.deepEqual(parse_peer_alerts(`${peer_alert_intro}\n\n${loop}`), []);
  assert.deepEqual(parse_peer_alerts("Reviewer (agent_x) sent an update while still running."), []);
});

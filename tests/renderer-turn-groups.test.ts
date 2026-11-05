import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import { turn_leader, turn_segments } from "../src/state/turn-groups.ts";
import { agents, at, deployed, expanded, head_text, press, reasoning, setup, show_turn, shown_with_class, teardown, text, tool, toggle, turn, visible, with_class } from "./turn-fold-harness.ts";

before(setup);
after(teardown);

const user = (id: string, origin: UserMessage["origin"], created_at = at(0)): UserMessage => ({ id, role: "user", text: "agent finished", attachments: [], origin, created_at });

const continuation = (id: string, status: AssistantMessage["status"], created: number, steps: AssistantMessage["steps"]) =>
  turn(id, status, steps.map((step) => ({ ...step, id: `${id}_${step.id}` })), at(created), status === "streaming" ? null : at(created + 20_000));

test("agent reports and update turns join the turn before them until a message of the user", () => {
  const leader = turn("a1", "done", deployed("a1"));
  const middle = continuation("a2", "done", 40_000, [text("t", "Waiting on Reader.")]);
  const final = continuation("a3", "done", 90_000, [tool("x", "read_file", 95_000), text("t", "Reader found it.")]);
  const messages: Message[] = [user("u1", "user"), leader, user("r1", "agent_update"), middle, user("r2", "agent_report"), final, user("u2", "user"), turn("a4", "done", [text("t", "ok")])];
  const segments = turn_segments(messages);
  assert.deepEqual(
    segments.map((segment) => (segment.kind === "user" ? `user:${segment.message.id}` : `turn:${segment.members.map((member) => member.id).join(",")}`)),
    ["user:u1", "turn:a1,a2,a3", "user:u2", "turn:a4"],
  );
  assert.equal(turn_leader(messages, "a3"), "a1");
  assert.equal(turn_leader(messages, "a4"), "a4");
});

test("a background result or a turn without a report in between starts its own turn", () => {
  const messages: Message[] = [turn("a1", "done", deployed("a1")), user("b1", "background"), turn("a2", "done", [text("t", "tests passed")]), turn("a3", "done", [])];
  assert.deepEqual(
    turn_segments(messages).map((segment) => (segment.kind === "turn" ? segment.members.map((member) => member.id).join(",") : segment.message.id)),
    ["a1", "b1", "a2", "a3"],
  );
});

test("a chain of report turns shows one head, keeps working while the agent runs and folds into one Worked for at the end", () => {
  agents("c_group", "ready", "running");
  const leader = turn("g1", "done", deployed("g1", "c_group"));
  const middle = continuation("g2", "done", 40_000, [reasoning("r", 41_000), text("t", "Waiting on Reader.")]);
  const report = user("gr", "agent_report", at(80_000));
  const final = continuation("g3", "done", 90_000, [tool("x", "read_file", 99_000), text("t", "Reader found the bug.")]);
  show_turn("c_group", [leader, user("gu", "agent_update", at(35_000)), middle, report]);
  assert.equal(with_class("turn-head").length, 1);
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  assert.equal(visible().includes("file_changes"), false);
  agents("c_group", "ready", "completed");
  show_turn("c_group", [leader, user("gu", "agent_update", at(35_000)), middle, report, final]);
  assert.equal(with_class("turn-head").length, 1);
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 1m 39s");
  assert.deepEqual(visible(), ["text", "file_changes"]);
  assert.equal(shown_with_class("origin-note"), 0);
  press(toggle()!);
  assert.deepEqual(visible(), ["work", "text", "reasoning", "text", "work", "text", "file_changes"]);
  assert.equal(shown_with_class("origin-note"), 2);
  show_turn("c_group", null);
});

test("while the last report turn streams, the chain keeps its single Working head", () => {
  agents("c_live", "ready", "completed");
  const leader = turn("l1", "done", deployed("l1", "c_live"));
  const live = continuation("l2", "streaming", 60_000, [tool("x", "read_file", null)]);
  show_turn("c_live", [leader, user("lr", "agent_report", at(55_000)), live]);
  assert.equal(with_class("turn-head").length, 1);
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  show_turn("c_live", null);
});

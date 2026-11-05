import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chip_line,
  draft_of,
  draft_sendable,
  empty_composer,
  has_chip,
  message_text,
  move_draft,
  patch_draft,
  remove_chip,
  take_draft,
  toggle_chip,
} from "../src/state/chat-drafts.ts";

const skill = { kind: "skill", name: "frontend-design" } as const;
const server = { kind: "mcp", name: "blender" } as const;

test("a new draft has no chips and toggling adds a chip once and removes it again", () => {
  assert.deepEqual(draft_of(empty_composer, "c1").chips, []);
  let state = toggle_chip(empty_composer, "c1", skill);
  state = toggle_chip(state, "c1", server);
  assert.deepEqual(draft_of(state, "c1").chips, [skill, server]);
  assert.equal(has_chip(draft_of(state, "c1"), { kind: "skill", name: "frontend-design" }), true);
  assert.equal(has_chip(draft_of(state, "c1"), { kind: "mcp", name: "frontend-design" }), false);
  state = toggle_chip(state, "c1", { kind: "skill", name: "frontend-design" });
  assert.deepEqual(draft_of(state, "c1").chips, [server]);
  state = remove_chip(state, "c1", server);
  assert.deepEqual(draft_of(state, "c1").chips, []);
  assert.deepEqual(draft_of(state, "c2").chips, []);
});

test("each chip becomes one explicit English instruction line", () => {
  assert.equal(chip_line(skill), 'Use the skill "frontend-design" for this request: load it with read_skill first and follow it.');
  assert.equal(chip_line(server), 'Use the tools of the MCP server "blender" for this request.');
});

test("the message puts chip lines above the typed text and leaves plain drafts untouched", () => {
  const draft = { ...draft_of(empty_composer, "c1"), text: "  build the menu  ", chips: [skill, server] };
  assert.equal(message_text(draft), `${chip_line(skill)}\n${chip_line(server)}\n\nbuild the menu`);
  assert.equal(message_text({ ...draft, chips: [] }), "build the menu");
  assert.equal(message_text({ ...draft, text: "" }), `${chip_line(skill)}\n${chip_line(server)}`);
});

test("a chip alone makes the draft sendable and taking the draft clears chips with the text", () => {
  let state = toggle_chip(empty_composer, "c1", skill);
  assert.equal(draft_sendable(draft_of(state, "c1")), true);
  state = patch_draft(state, "c1", { text: "go", plan: true });
  const taken = take_draft(state, "c1");
  assert.equal(taken.message.text, `${chip_line(skill)}\n\ngo`);
  assert.equal(taken.message.plan, true);
  assert.deepEqual(draft_of(taken.state, "c1"), { text: "", uploads: [], plan: true, chips: [] });
});

test("chips move with the draft when a new chat takes it over", () => {
  const state = move_draft(toggle_chip(empty_composer, "new:D:\\p", server), "new:D:\\p", "new:D:\\q");
  assert.deepEqual(draft_of(state, "new:D:\\q").chips, [server]);
  assert.deepEqual(draft_of(state, "new:D:\\p").chips, []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { removed_output_stub } from "../electron/context/window.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { content_blocks, image_marker, message_blocks } from "../electron/turn/claude/content.ts";
import { carried_history, handoff_footer, handoff_header, handoff_text } from "../electron/turn/claude/handoff.ts";
import { claude_harness, claude_model, make_tool } from "./claude-turn-kit.ts";

const conversation: ApiMessage[] = [
  { role: "user", content: "Fix the parser" },
  {
    role: "assistant",
    content: "Looking at it.",
    tool_calls: [
      { id: "call_a", type: "function", function: { name: "read_file", arguments: '{"path":"src/parser.ts"}' } },
      { id: "call_b", type: "function", function: { name: "grep_files", arguments: '{"query":"tokenize"}' } },
    ],
  },
  { role: "tool", tool_call_id: "call_a", content: "export const parse = () => null;" },
  { role: "tool", tool_call_id: "call_b", content: "src/lexer.ts:4" },
  { role: "user", tool_images: true, content: [{ type: "text", text: "Screen 1" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] },
  { role: "assistant", content: null, tool_calls: [{ id: "call_c", type: "function", function: { name: "run_command", arguments: '{"command":"npm test"}' } }] },
  { role: "tool", tool_call_id: "call_c", content: "1 failing" },
  { role: "assistant", content: "The tokenizer drops the last token." },
];

test("the hand-over renders every earlier message between the header and the footer", () => {
  assert.equal(
    handoff_text(conversation),
    [
      "[Earlier conversation of this chat, carried over by the app. Everything below up to the end marker already happened: the tool calls ran and their results are final. Do not repeat these calls and do not reply to this block. Continue with the message that follows the end marker.]",
      "USER: Fix the parser",
      "ASSISTANT: Looking at it.",
      'TOOL CALL read_file {"path":"src/parser.ts"}',
      'TOOL CALL grep_files {"query":"tokenize"}',
      "TOOL RESULT read_file: export const parse = () => null;",
      "TOOL RESULT grep_files: src/lexer.ts:4",
      "USER: Screen 1\n[image not carried over]",
      'TOOL CALL run_command {"command":"npm test"}',
      "TOOL RESULT run_command: 1 failing",
      "ASSISTANT: The tokenizer drops the last token.",
      "[End of the earlier conversation.]",
    ].join("\n\n"),
  );
  assert.equal(handoff_header.startsWith("[Earlier conversation of this chat"), true);
  assert.equal(handoff_footer, "[End of the earlier conversation.]");
});

test("an empty earlier conversation gives no hand-over", () => {
  assert.equal(handoff_text([]), null);
  assert.equal(handoff_text([{ role: "user", content: "" }]), null);
});

test("the hand-over runs the same window fit as the loop and shows the trimmed notice when it cut outputs", () => {
  const h = claude_harness([make_tool("read_file", async () => ({ status: "done", text: "", view: null }))], { model: { ...claude_model, context_length: 4000 } });
  const huge = "x".repeat(40_000);
  const messages: ApiMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "read both" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_a", content: huge },
    { role: "assistant", content: "Read it." },
    { role: "user", content: "now continue" },
  ];
  const text = carried_history(h.session, messages, messages.length - 1);
  assert.ok(text?.includes(`TOOL RESULT read_file: ${removed_output_stub}`));
  assert.equal(text?.includes(huge), false);
  assert.deepEqual(h.events, [{ type: "notice", round: 0, notice: "context_trimmed", text: "" }]);
});

test("a hand-over that fits emits no notice and leaves the messages unchanged", () => {
  const h = claude_harness([]);
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...conversation, { role: "user", content: "next" }];
  const before = JSON.stringify(messages);
  const text = carried_history(h.session, messages, messages.length - 1);
  assert.equal(text, handoff_text(conversation));
  assert.equal(JSON.stringify(messages), before);
  assert.deepEqual(h.events, []);
});

test("fresh content keeps its images as base64 blocks and marks images Claude cannot take", () => {
  assert.deepEqual(content_blocks([{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }]), [
    { type: "text", text: "see" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } },
  ]);
  assert.deepEqual(content_blocks([{ type: "image_url", image_url: { url: "data:image/bmp;base64,Qk0=" } }]), [{ type: "text", text: image_marker }]);
  assert.deepEqual(content_blocks(""), []);
  assert.deepEqual(message_blocks({ role: "user", content: "plain" }), [{ type: "text", text: "plain" }]);
});

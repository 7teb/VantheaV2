import assert from "node:assert/strict";
import { test } from "node:test";
import { output_wrapper_type, plan_input, without_plan_items, wrap_output } from "../electron/model/plan/input.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { ToolSpec } from "../electron/tools/types.ts";
import { call_item, message_item, reasoning_item } from "./plan-harness.ts";

const read_spec: ToolSpec = { name: "read_file", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } };

const shell_spec: ToolSpec = { name: "run_command", description: "run a command", parameters: { type: "object", properties: {} } };

const tools_item = {
  type: "additional_tools",
  role: "developer",
  tools: [
    { type: "function", name: "read_file", description: "read a file", parameters: read_spec.parameters, strict: false },
    { type: "function", name: "run_command", description: "run a command", parameters: shell_spec.parameters, strict: false },
  ],
};

test("the system prompt leads as a developer message and the tools follow it in one item", () => {
  const messages: ApiMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "first question" },
    { role: "system", content: "later instruction" },
  ];
  assert.deepEqual(plan_input(messages, [read_spec, shell_spec]), [
    { type: "message", role: "developer", content: "system prompt" },
    tools_item,
    { type: "message", role: "user", content: "first question" },
    { type: "message", role: "developer", content: "later instruction" },
  ]);
});

test("without a leading system message the tools item comes first, and no tools means no item", () => {
  const messages: ApiMessage[] = [{ role: "user", content: "hi" }];
  assert.deepEqual(plan_input(messages, [read_spec, shell_spec]), [tools_item, { type: "message", role: "user", content: "hi" }]);
  assert.deepEqual(plan_input(messages, []), [{ type: "message", role: "user", content: "hi" }]);
});

test("user parts become input text and input images, cache markers and internal flags are not sent", () => {
  const messages: ApiMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "look", prompt_cache_breakpoint: { mode: "explicit" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        { type: "image_url", image_url: { url: "https://example.test/a.png", detail: "high" } },
      ],
      tool_images: true,
      steer: true,
    },
  ];
  assert.deepEqual(plan_input(messages, []), [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "look" },
        { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
        { type: "input_image", image_url: "https://example.test/a.png", detail: "high" },
      ],
    },
  ]);
});

const wrapped_turn = (): ApiMessage[] => [
  { role: "system", content: "system prompt" },
  { role: "user", content: "do it" },
  {
    role: "assistant",
    content: "Reading both files.",
    reasoning_details: wrap_output([
      reasoning_item("rs_1", "plan the reads"),
      message_item("Reading both files.", "msg_1"),
      call_item("call_provider_a", "read_file", "fc_1", '{"path":"a"}'),
      call_item("call_provider_b", "read_file", "fc_2", '{"path":"b"}'),
    ]),
    tool_calls: [
      { id: "call_chat0001_r0c0", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } },
      { id: "call_chat0001_r0c1", type: "function", function: { name: "read_file", arguments: "{}" } },
    ],
  },
  { role: "tool", tool_call_id: "call_chat0001_r0c0", content: "content a" },
  { role: "tool", tool_call_id: "call_chat0001_r0c1", content: "content b" },
];

test("a wrapped assistant message replays its output items verbatim with restored arguments and provider call ids", () => {
  const input = plan_input(wrapped_turn(), []);
  assert.deepEqual(input.slice(2), [
    reasoning_item("rs_1", "plan the reads"),
    message_item("Reading both files.", "msg_1"),
    call_item("call_provider_a", "read_file", "fc_1", '{"path":"a"}'),
    call_item("call_provider_b", "read_file", "fc_2", "{}"),
    { type: "function_call_output", call_id: "call_provider_a", output: "content a" },
    { type: "function_call_output", call_id: "call_provider_b", output: "content b" },
  ]);
});

test("the wrapper stores function calls without their arguments", () => {
  const [wrapper] = wrap_output([message_item("x"), call_item("call_1", "read_file", "fc_1", '{"path":"a"}')]) as { type: string; items: Record<string, unknown>[] }[];
  assert.equal(wrapper?.type, output_wrapper_type);
  assert.deepEqual(wrapper?.items[0], message_item("x"));
  assert.equal("arguments" in (wrapper?.items[1] ?? {}), false);
  assert.equal(wrapper?.items[1]?.call_id, "call_1");
});

test("a wrapper whose function call count differs from the tool calls is ignored", () => {
  const messages = wrapped_turn();
  const assistant = messages[2];
  assert.ok(assistant?.role === "assistant");
  assistant.reasoning_details = wrap_output([message_item("Reading both files."), call_item("call_provider_a", "read_file", "fc_1", "")]);
  assert.deepEqual(plan_input(messages, []).slice(2), [
    { type: "message", role: "assistant", content: "Reading both files." },
    { type: "function_call", call_id: "call_chat0001_r0c0", name: "read_file", arguments: '{"path":"a"}' },
    { type: "function_call", call_id: "call_chat0001_r0c1", name: "read_file", arguments: "{}" },
    { type: "function_call_output", call_id: "call_chat0001_r0c0", output: "content a" },
    { type: "function_call_output", call_id: "call_chat0001_r0c1", output: "content b" },
  ]);
});

test("OpenRouter reasoning details and reasoning text are dropped and an older wrapped turn replays verbatim with its reasoning", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "old question" },
    { role: "assistant", content: "old answer", reasoning_details: wrap_output([reasoning_item("rs_0", "old"), message_item("old answer", "msg_0")]) },
    { role: "user", content: "new question" },
    { role: "assistant", content: "thinking aloud", reasoning_details: [{ type: "reasoning.encrypted", data: "abc" }] },
    { role: "assistant", content: "plain", reasoning: "hidden reasoning" },
  ];
  assert.deepEqual(plan_input(messages, []), [
    { type: "message", role: "user", content: "old question" },
    reasoning_item("rs_0", "old"),
    message_item("old answer", "msg_0"),
    { type: "message", role: "user", content: "new question" },
    { type: "message", role: "assistant", content: "thinking aloud" },
    { type: "message", role: "assistant", content: "plain" },
  ]);
});

test("an older wrapped turn replays exactly the items it sent during its own turn, so the prefix stays cacheable", () => {
  const during = plan_input(wrapped_turn(), []);
  const later = plan_input([...wrapped_turn(), { role: "user", content: "next question" }], []);
  assert.deepEqual(later.slice(0, during.length), during);
  assert.deepEqual(later.at(-1), { type: "message", role: "user", content: "next question" });
});

test("an older wrapped turn keeps its messages with their phase and its calls with the provider call ids", () => {
  const messages: ApiMessage[] = [...wrapped_turn(), { role: "user", content: "next question" }];
  const commentary = { ...message_item("Reading both files.", "msg_1"), phase: "commentary" };
  const assistant = messages[2];
  assert.ok(assistant?.role === "assistant");
  assistant.reasoning_details = wrap_output([
    reasoning_item("rs_1", "plan the reads"),
    commentary,
    call_item("call_provider_a", "read_file", "fc_1", '{"path":"a"}'),
    call_item("call_provider_b", "read_file", "fc_2", '{"path":"b"}'),
  ]);
  assert.deepEqual(plan_input(messages, []).slice(2), [
    reasoning_item("rs_1", "plan the reads"),
    commentary,
    call_item("call_provider_a", "read_file", "fc_1", '{"path":"a"}'),
    call_item("call_provider_b", "read_file", "fc_2", "{}"),
    { type: "function_call_output", call_id: "call_provider_a", output: "content a" },
    { type: "function_call_output", call_id: "call_provider_b", output: "content b" },
    { type: "message", role: "user", content: "next question" },
  ]);
});

test("a reasoning item of the current turn without encrypted content is left out of the replay", () => {
  const messages = wrapped_turn();
  const assistant = messages[2];
  assert.ok(assistant?.role === "assistant");
  const bare: Record<string, unknown> = reasoning_item("rs_0", "no content");
  delete bare.encrypted_content;
  assistant.reasoning_details = wrap_output([
    bare,
    { ...reasoning_item("rs_2", "empty content"), encrypted_content: "" },
    reasoning_item("rs_1", "plan the reads"),
    message_item("Reading both files.", "msg_1"),
    call_item("call_provider_a", "read_file", "fc_1", '{"path":"a"}'),
    call_item("call_provider_b", "read_file", "fc_2", '{"path":"b"}'),
  ]);
  assert.deepEqual(plan_input(messages, []).slice(2, 4), [reasoning_item("rs_1", "plan the reads"), message_item("Reading both files.", "msg_1")]);
  assert.equal(plan_input(messages, []).length, 8);
});

test("an assistant message with only tool calls sends no empty message item", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "go" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "run_command", arguments: '{"command":"ls"}' } }] },
    { role: "tool", tool_call_id: "call_x", content: "listing" },
  ];
  assert.deepEqual(plan_input(messages, []).slice(1), [
    { type: "function_call", call_id: "call_x", name: "run_command", arguments: '{"command":"ls"}' },
    { type: "function_call_output", call_id: "call_x", output: "listing" },
  ]);
});

test("without_plan_items keeps the array when nothing is wrapped and strips only wrapped messages otherwise", () => {
  const plain: ApiMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello", reasoning_details: [{ type: "reasoning.text", text: "r" }] },
  ];
  assert.equal(without_plan_items(plain), plain);
  const wrapped = wrapped_turn();
  const stripped = without_plan_items(wrapped);
  assert.notEqual(stripped, wrapped);
  assert.equal(stripped[0], wrapped[0]);
  assert.equal(stripped[3], wrapped[3]);
  const assistant = stripped[2];
  assert.ok(assistant?.role === "assistant");
  assert.equal("reasoning_details" in assistant, false);
  assert.equal(assistant.tool_calls?.length, 2);
  assert.equal(assistant.content, "Reading both files.");
  const original = wrapped[2];
  assert.ok(original?.role === "assistant");
  assert.equal(original.reasoning_details?.length, 1);
});

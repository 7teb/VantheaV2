import assert from "node:assert/strict";
import { test } from "node:test";
import { create_accumulator } from "../electron/model/accumulator.ts";

const delta = (value: Record<string, unknown>, finish_reason: string | null = null) => ({
  id: "gen-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "x/y",
  choices: [{ index: 0, delta: value, finish_reason }],
});

const ids = () => {
  let next = 0;
  return () => `call_gen_${(next += 1)}`;
};

test("content, reasoning, finish reason and the trailing usage chunk", () => {
  const acc = create_accumulator();
  const first = acc.push(delta({ role: "assistant", content: "", reasoning: "Let me " }));
  assert.equal(first.reasoning, "Let me ");
  acc.push(delta({ reasoning: "think." }));
  assert.equal(acc.push(delta({ content: "Hello" })).text, "Hello");
  const last = acc.push(delta({ content: " world" }, "stop"));
  assert.equal(last.finish_reason, "stop");
  acc.push({
    ...delta({ content: "", role: "assistant" }, "stop"),
    usage: { prompt_tokens: 12, completion_tokens: 30, total_tokens: 42, completion_tokens_details: { reasoning_tokens: 9 } },
  });
  const done = acc.finish(new Set(), ids());
  assert.equal(done.content, "Hello world");
  assert.equal(done.reasoning, "Let me think.");
  assert.equal(done.finish_reason, "stop");
  assert.deepEqual(done.usage, { prompt_tokens: 12, completion_tokens: 30, reasoning_tokens: 9 });
});

test("a provider refusal reads as content_filter, also when only native_finish_reason says refusal", () => {
  const normalized = create_accumulator();
  normalized.push(delta({ content: "Blocked." }, "content_filter"));
  assert.equal(normalized.finish(new Set(), ids()).finish_reason, "content_filter");
  const native = create_accumulator();
  native.push({ choices: [{ index: 0, delta: { content: "Blocked." }, finish_reason: "stop", native_finish_reason: "refusal" }] });
  assert.equal(native.finish(new Set(), ids()).finish_reason, "content_filter");
});

test("reasoning_details fragments merge by type and index and are not shown twice", () => {
  const acc = create_accumulator();
  const fragment = (text: string, extra: Record<string, unknown> = {}) => ({
    type: "reasoning.text",
    text,
    signature: null,
    id: "reasoning-text-1",
    format: "anthropic-claude-v1",
    index: 0,
    ...extra,
  });
  const both = acc.push(delta({ reasoning: "Step one", reasoning_details: [fragment("Step one")] }));
  assert.equal(both.reasoning, "Step one");
  const details_only = acc.push(delta({ reasoning_details: [fragment(", step two", { signature: "sig-abc" })] }));
  assert.equal(details_only.reasoning, ", step two");
  acc.push(delta({ reasoning_details: [{ type: "reasoning.encrypted", data: "AAA", format: "anthropic-claude-v1", index: 1 }] }));
  acc.push(delta({ reasoning_details: [{ type: "reasoning.summary", summary: "Sum", index: 2 }] }));
  acc.push(delta({ reasoning_details: [{ type: "reasoning.summary", summary: "mary", index: 2 }] }, "stop"));
  const done = acc.finish(new Set(), ids());
  assert.deepEqual(done.reasoning_details, [
    { type: "reasoning.text", text: "Step one, step two", signature: "sig-abc", id: "reasoning-text-1", format: "anthropic-claude-v1", index: 0 },
    { type: "reasoning.encrypted", data: "AAA", format: "anthropic-claude-v1", index: 1 },
    { type: "reasoning.summary", summary: "Summary", index: 2 },
  ]);
  assert.equal(done.reasoning, "Step one, step twoSummary");
});

test("tool calls assemble by index, keep the first id and never double a repeated name", () => {
  const acc = create_accumulator();
  const call = (index: number, value: Record<string, unknown>) => ({ index, type: "function", ...value });
  const first = acc.push(delta({ tool_calls: [call(0, { id: "call_a", function: { name: "read_file", arguments: "" } })] }));
  assert.deepEqual(first.drafted, [0]);
  acc.push(delta({ tool_calls: [call(0, { function: { name: "read_file", arguments: '{"path":' } })] }));
  acc.push(delta({ tool_calls: [call(1, { id: "call_b", function: { name: "list_", arguments: "" } })] }));
  acc.push(delta({ tool_calls: [call(1, { function: { name: "files", arguments: "{}" } })] }));
  acc.push(delta({ tool_calls: [call(0, { id: "call_other", function: { arguments: '"a.ts"}' } })] }));
  acc.push(delta({ tool_calls: [call(2, { function: { name: "grep", arguments: '{"query":"x"}' } })] }, "tool_calls"));
  const done = acc.finish(new Set(), ids());
  assert.deepEqual(done.tool_calls, [
    { index: 0, id: "call_a", name: "read_file", arguments: '{"path":"a.ts"}' },
    { index: 1, id: "call_b", name: "list_files", arguments: "{}" },
    { index: 2, id: "call_gen_1", name: "grep", arguments: '{"query":"x"}' },
  ]);
  assert.equal(done.finish_reason, "tool_calls");
});

test("a mid-stream error chunk is reported with its typed code", () => {
  const acc = create_accumulator();
  const outcome = acc.push({
    ...delta({ content: "" }, "error"),
    error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded", provider_code: "rate_limited" } },
  });
  assert.deepEqual(outcome.error, {
    code: 429,
    message: "Rate limit exceeded",
    error_type: "rate_limit_exceeded",
    provider_code: "rate_limited",
    limit_source: "",
    moderation: false,
    provider_name: "",
    raw: "",
  });
});

const split = (chunks: string[]) => {
  const acc = create_accumulator();
  let text = "";
  let reasoning = "";
  for (const chunk of chunks) {
    const outcome = acc.push(delta({ content: chunk }));
    text += outcome.text;
    reasoning += outcome.reasoning;
  }
  acc.push(delta({}, "stop"));
  const done = acc.finish(new Set(), ids());
  return { text: text + done.flushed_text, reasoning: reasoning + done.flushed_reasoning, content: done.content };
};

test("think tags move text into reasoning instead of dropping it", () => {
  assert.deepEqual(split(["normal answer"]), { text: "normal answer", reasoning: "", content: "normal answer" });
  assert.equal(split(["<div>normal</div>"]).text, "<div>normal</div>");
  assert.deepEqual(split(["before <think>private</think> after"]), { text: "before  after", reasoning: "private", content: "before  after" });
  assert.deepEqual(split(["a <ThInKiNg>private</THINKING> b"]), { text: "a  b", reasoning: "private", content: "a  b" });
  assert.equal(split(["answer</think>"]).text, "answer");
  assert.equal(split(["answer</thinking>"]).text, "answer");
  assert.deepEqual(split(["safe<think>```cpp\nint hidden;\n```</think>done"]), {
    text: "safedone",
    reasoning: "```cpp\nint hidden;\n```",
    content: "safedone",
  });
  assert.deepEqual(split(["a<think>x</think>b<thinking>y</thinking>c"]), { text: "abc", reasoning: "xy", content: "abc" });
  assert.deepEqual(split(["visible<thinking>never closed"]), { text: "visible", reasoning: "never closed", content: "visible" });
  assert.equal(split(["visible</think"]).text, "visible");
  assert.equal(split(["visible</thinking"]).text, "visible");
  assert.equal(split(["a < b"]).text, "a < b");
  assert.equal(split(["ends with <"]).text, "ends with <");
});

test("think tag splitting is stable across every chunk boundary", () => {
  const samples = [
    { input: "before<think>hidden</think>after", text: "beforeafter", reasoning: "hidden" },
    { input: "before<thinking>hidden</thinking>after", text: "beforeafter", reasoning: "hidden" },
    { input: "before</think>after", text: "beforeafter", reasoning: "" },
    { input: "before</thinking>after", text: "beforeafter", reasoning: "" },
  ];
  for (const sample of samples) {
    for (let cut = 0; cut <= sample.input.length; cut += 1) {
      const result = split([sample.input.slice(0, cut), sample.input.slice(cut)]);
      assert.equal(result.text, sample.text, `${sample.input} cut ${cut}`);
      assert.equal(result.reasoning, sample.reasoning, `${sample.input} cut ${cut}`);
    }
    const single = split([...sample.input]);
    assert.equal(single.text, sample.text);
    assert.equal(single.reasoning, sample.reasoning);
  }
});

const recover = (chunks: string[], known: string[], structured = false) => {
  const acc = create_accumulator();
  let streamed = "";
  for (const chunk of chunks) {
    streamed += acc.push(delta({ content: chunk })).text;
  }
  if (structured) {
    acc.push(delta({ tool_calls: [{ index: 0, id: "call_s", function: { name: "read_file", arguments: "{}" } }] }));
  }
  acc.push(delta({}, "stop"));
  const done = acc.finish(new Set(known), ids());
  return { streamed, done };
};

test("explicit <tool_call> markers are recovered and never streamed as text", () => {
  const { streamed, done } = recover(["I will read it.\n<tool", '_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>'], ["read_file"]);
  assert.equal(streamed, "I will read it.\n");
  assert.equal(done.flushed_text, "");
  assert.equal(done.content, "I will read it.\n");
  assert.deepEqual(done.tool_calls, [{ index: 0, id: "call_gen_1", name: "read_file", arguments: '{"path":"a.ts"}' }]);
});

test("an unknown tool name in markers stays visible text", () => {
  const raw = '<tool_call>{"name":"format_disk","arguments":{}}</tool_call>';
  const { done } = recover(["x ", raw], ["read_file"]);
  assert.deepEqual(done.tool_calls, []);
  assert.equal(done.flushed_text, raw);
  assert.equal(done.content, `x ${raw}`);
});

test("JSON code fences are never treated as tool calls", () => {
  const fence = '```json\n{"name":"read_file","arguments":{"path":"a.ts"}}\n```';
  const { streamed, done } = recover([fence], ["read_file"]);
  assert.equal(streamed, fence);
  assert.deepEqual(done.tool_calls, []);
});

test("DeepSeek tool markers are recovered in both template shapes", () => {
  const bar = "｜";
  const sp = "▁";
  const begin_all = `<${bar}tool${sp}calls${sp}begin${bar}>`;
  const end_all = `<${bar}tool${sp}calls${sp}end${bar}>`;
  const begin = `<${bar}tool${sp}call${sp}begin${bar}>`;
  const sep = `<${bar}tool${sp}sep${bar}>`;
  const end = `<${bar}tool${sp}call${sp}end${bar}>`;
  const fenced = `${begin_all}${begin}function${sep}read_file\n\`\`\`json\n{"path":"a.ts"}\n\`\`\`${end}${end_all}`;
  const plain = `${begin_all}${begin}grep${sep}{"query":"x"}${end}${end_all}`;
  const first = recover(["Reading.", fenced], ["read_file"]);
  assert.equal(first.streamed, "Reading.");
  assert.deepEqual(first.done.tool_calls, [{ index: 0, id: "call_gen_1", name: "read_file", arguments: '{"path":"a.ts"}' }]);
  assert.equal(first.done.flushed_text, "");
  const second = recover([plain], ["grep"]);
  assert.deepEqual(second.done.tool_calls, [{ index: 0, id: "call_gen_1", name: "grep", arguments: '{"query":"x"}' }]);
});

test("held marker text is released unchanged when structured tool calls exist", () => {
  const raw = '<tool_call>{"name":"read_file","arguments":{}}</tool_call>';
  const { done } = recover([raw], ["read_file"], true);
  assert.equal(done.flushed_text, raw);
  assert.deepEqual(
    done.tool_calls.map((call) => call.id),
    ["call_s"],
  );
});

test("tool drafts decode per index, only for draft tools, even when the name arrives after the first arguments", () => {
  const acc = create_accumulator();
  const call = (index: number, value: Record<string, unknown>) => ({ index, type: "function", ...value });
  acc.push(delta({ tool_calls: [call(0, { id: "call_r", function: { name: "read_file", arguments: '{"path":"x"}' } })] }));
  assert.equal(acc.draft(0), null);
  acc.push(delta({ tool_calls: [call(1, { function: { arguments: '{"path":"a.ts","con' } })] }));
  assert.equal(acc.draft(1), null);
  acc.push(delta({ tool_calls: [call(1, { id: "call_w", function: { name: "write_file", arguments: 'tent":"one\\ntw' } })] }));
  assert.deepEqual(acc.draft(1)?.take(), { delta: "one\ntw", lines: 2, path: "a.ts", old_text: null });
  acc.push(delta({ tool_calls: [call(2, { function: { name: "replace_in_file", arguments: '{"old_string":"a\\\\nb","new_string":"c' } })] }));
  acc.push(delta({ tool_calls: [call(1, { function: { arguments: 'o\\nthr' } })] }));
  assert.deepEqual(acc.draft(1)?.take(), { delta: "o\nthr", lines: 3, path: null, old_text: null });
  assert.deepEqual(acc.draft(2)?.take(), { delta: "c", lines: 1, path: null, old_text: "a\\nb" });
  assert.equal(acc.draft(1)?.pending(), false);
});

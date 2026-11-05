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

const run = (chunks: string[], known: string[]) => {
  const acc = create_accumulator();
  const streamed: string[] = [];
  for (const chunk of chunks) {
    streamed.push(acc.push(delta({ content: chunk })).text);
  }
  acc.push(delta({}, "stop"));
  const done = acc.finish(new Set(known), ids());
  return { streamed, done, text: streamed.join("") + done.flushed_text };
};

const bar = "｜";
const sp = "▁";
const begin_all = `<${bar}tool${sp}calls${sp}begin${bar}>`;
const end_all = `<${bar}tool${sp}calls${sp}end${bar}>`;
const begin = `<${bar}tool${sp}call${sp}begin${bar}>`;
const sep = `<${bar}tool${sp}sep${bar}>`;
const end = `<${bar}tool${sp}call${sp}end${bar}>`;

const write_call = '<tool_call>\n{"name": "write_file", "arguments": {"path": "example.txt", "content": "hello"}}\n</tool_call>';

const fenced_example = `Here is how a tool call looks:\n\n\`\`\`xml\n${write_call}\n\`\`\`\n\nThe runtime executes that block.`;

test("a fenced <tool_call> example in a normal answer is streamed as text and never executed", () => {
  const { streamed, done, text } = run([fenced_example.slice(0, 40), fenced_example.slice(40, 90), fenced_example.slice(90)], ["write_file"]);
  assert.deepEqual(done.tool_calls, []);
  assert.equal(text, fenced_example);
  assert.equal(done.content, fenced_example);
  assert.equal(streamed.join(""), fenced_example);
  assert.equal(done.flushed_text, "");
});

test("a fenced DeepSeek template example is not recovered", () => {
  const example = `DeepSeek template:\n\`\`\`\n${begin_all}${begin}function${sep}write_file\n\`\`\`json\n{"path":"ds.txt","content":"x"}\n\`\`\`${end}${end_all}\n\`\`\`\nThat is all.`;
  const { done, text } = run([example], ["write_file"]);
  assert.deepEqual(done.tool_calls, []);
  assert.equal(text, example);
});

test("tilde fences and longer backtick fences protect markers", () => {
  const tilde = `~~~\n${write_call}\n~~~\nafter`;
  assert.deepEqual(run([tilde], ["write_file"]).done.tool_calls, []);
  assert.equal(run([tilde], ["write_file"]).text, tilde);
  const long = `\`\`\`\`markdown\n\`\`\`\nnot a close\n\`\`\`\n${write_call}\n\`\`\`\`\nafter`;
  assert.deepEqual(run([long], ["write_file"]).done.tool_calls, []);
  assert.equal(run([long], ["write_file"]).text, long);
  const indented = `1. Step:\n\n      \`\`\`\n      ${write_call}\n      \`\`\`\n`;
  assert.deepEqual(run([indented], ["write_file"]).done.tool_calls, []);
});

test("an inline code mention of a marker does not hold back the following text", () => {
  const { streamed, done } = run(["Models wrap calls in `<tool_call>` tags. ", "Rest of the explanation.", " ``<tool_call>`` too."], ["write_file"]);
  assert.deepEqual(streamed, ["Models wrap calls in `<tool_call>` tags. ", "Rest of the explanation.", " ``<tool_call>`` too."]);
  assert.equal(done.flushed_text, "");
  assert.deepEqual(done.tool_calls, []);
});

test("an inline code span with a full call is not executed", () => {
  const inline = `Write \`<tool_call>{"name":"write_file","arguments":{"path":"a","content":"b"}}</tool_call>\` to call it.`;
  const { done, text } = run([inline], ["write_file"]);
  assert.deepEqual(done.tool_calls, []);
  assert.equal(text, inline);
});

test("an unfenced tagged call after a closed fence is still recovered", () => {
  const input = `Code:\n\`\`\`js\nlet a = "\`";\n\`\`\`\nNow reading.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>`;
  const { done, text } = run([input], ["read_file"]);
  assert.equal(text, "Code:\n```js\nlet a = \"`\";\n```\nNow reading.\n");
  assert.deepEqual(done.tool_calls, [{ index: 0, id: "call_gen_1", name: "read_file", arguments: '{"path":"a.ts"}' }]);
});

test("an escaped backtick does not open an inline span in front of a real call", () => {
  const input = 'Use \\` carefully.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>';
  assert.equal(run([input], ["read_file"]).done.tool_calls.length, 1);
});

test("an unfenced DeepSeek call after an inline mention is still recovered", () => {
  const input = `The \`${begin}\` marker starts a call.\n${begin_all}${begin}function${sep}read_file\n\`\`\`json\n{"path":"a.ts"}\n\`\`\`${end}${begin}grep${sep}{"query":"x"}${end}${end_all}`;
  const { done, text } = run([input], ["read_file", "grep"]);
  assert.equal(text, `The \`${begin}\` marker starts a call.\n`);
  assert.deepEqual(
    done.tool_calls.map((call) => [call.name, call.arguments]),
    [
      ["read_file", '{"path":"a.ts"}'],
      ["grep", '{"query":"x"}'],
    ],
  );
});

test("fence state survives every chunk boundary", () => {
  for (let cut = 0; cut <= fenced_example.length; cut += 1) {
    const { done, text } = run([fenced_example.slice(0, cut), fenced_example.slice(cut)], ["write_file"]);
    assert.deepEqual(done.tool_calls, [], `cut ${cut}`);
    assert.equal(text, fenced_example, `cut ${cut}`);
  }
  const single = run([...fenced_example], ["write_file"]);
  assert.deepEqual(single.done.tool_calls, []);
  assert.equal(single.text, fenced_example);
});

test("a real call followed by a fenced example recovers only the real call", () => {
  const real = '<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>';
  const example = `\`\`\`\n${write_call}\n\`\`\``;
  const { done } = run([`Reading.\n${real}\nFor reference:\n${example}`], ["read_file", "write_file"]);
  assert.deepEqual(
    done.tool_calls.map((call) => call.name),
    ["read_file"],
  );
  assert.equal(done.flushed_text, `For reference:\n${example}`);
});

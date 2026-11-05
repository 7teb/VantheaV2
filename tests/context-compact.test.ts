import assert from "node:assert/strict";
import { test } from "node:test";
import { with_context_setting, type ModelEntry } from "../shared/models.ts";
import { compacted_messages, compaction_due, compaction_floor, is_user_voice, next_compaction } from "../electron/context/compact.ts";
import { compaction_request, resume_text } from "../electron/context/compact-text.ts";
import { estimate_request } from "../electron/context/usage.ts";
import type { ApiAssistantMessage, ApiMessage } from "../electron/model/types.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1000,
  max_output: 256,
  reasoning_passback: false,
};

const round = (index: number, size = 8): ApiMessage[] => [
  { role: "assistant", content: `r${index}`, tool_calls: [{ id: `c${index}`, type: "function", function: { name: "read_file", arguments: "{}" } }] },
  { role: "tool", tool_call_id: `c${index}`, content: "x".repeat(size) },
];

const contents = (messages: ApiMessage[]) => messages.map((message) => (typeof message.content === "string" ? message.content : ""));

test("compaction is due above 70 percent of the window and only after the context grew past the last attempt", () => {
  assert.equal(compaction_due(700, 0, model), false);
  assert.equal(compaction_due(701, 0, model), true);
  assert.equal(compaction_due(5000, 0, { ...model, context_length: 0 }), false);
  assert.equal(compaction_due(760, 720, model), false);
  assert.equal(compaction_due(820, 720, model), true);
});

test("the next compaction point is the first token count at which compaction is due", () => {
  assert.equal(next_compaction(0, model), 701);
  assert.equal(next_compaction(720, model), 820);
  assert.equal(next_compaction(0, { ...model, context_length: 0 }), null);
  for (const floor of [0, 650, 720, 900]) {
    const at = next_compaction(floor, model) ?? 0;
    assert.equal(compaction_due(at - 1, floor, model), false, String(floor));
    assert.equal(compaction_due(at, floor, model), true, String(floor));
  }
});

test("the floor is kept only while the context is still above 70 percent, otherwise the plain trigger re-arms", () => {
  assert.equal(compaction_floor(650, model), 0);
  assert.equal(compaction_floor(700, model), 0);
  assert.equal(compaction_floor(720, model), 720);
  assert.equal(compaction_due(705, compaction_floor(650, model), model), true);
  assert.equal(compaction_due(760, compaction_floor(720, model), model), false);
});

test("the request estimate counts images, the system prompt and tool specs", () => {
  const system = "s".repeat(2000);
  const messages: ApiMessage[] = [
    { role: "system", content: system },
    { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(40)}` } }] },
  ];
  const text_only = estimate_request([messages[0] as ApiMessage, { role: "user", content: "look" }], []);
  const with_image = estimate_request(messages, []);
  assert.ok(text_only >= 500);
  assert.ok(with_image - text_only >= 1000);
  const tools = [{ name: "read_file", description: "d".repeat(4000), parameters: { type: "object" as const, properties: {} } }];
  assert.ok(estimate_request(messages, tools) - with_image >= 1000);
});

test("the request estimate counts reasoning sent with assistant messages", () => {
  const bare: ApiMessage = { role: "assistant", content: "ok" };
  const plain = estimate_request([bare], []);
  assert.ok(estimate_request([{ ...bare, reasoning: "r".repeat(4000) }], []) - plain >= 1000);
  const details = [{ type: "reasoning.encrypted", data: "e".repeat(4000), index: 0 }];
  assert.ok(estimate_request([{ ...bare, reasoning_details: details }], []) - plain >= 1000);
});

test("the compacted context is the note, every user message, the last ten rounds and the harness record", () => {
  const history: ApiMessage[] = [
    { role: "user", compaction: true, content: "old note" },
    { role: "user", instruction: true, content: "first request" },
    ...round(1),
    { role: "user", content: "[Internal app event, not a user message. agent report]" },
    { role: "user", steer: true, content: "steer while working" },
    ...round(2),
    { role: "user", instruction: true, content: "second request" },
  ];
  for (let index = 3; index <= 12; index += 1) {
    history.push(...(index === 6 ? [{ role: "user", compaction: true, content: "old harness record" } as const] : []), ...round(index));
  }
  history.push({ role: "user", instruction: true, content: "third request" });
  const out = compacted_messages({ note: "TASK: x", facts: "Files changed:\n- a.ts (+1 -0)", audience: "user", history, model: { ...model, context_length: 1_000_000 } });
  assert.equal(out[0]?.role === "user" && out[0].compaction, true);
  assert.equal(out[0]?.content, `${resume_text("user")}\n\nTASK: x`);
  assert.deepEqual(contents(out.slice(1, 4)), ["first request", "steer while working", "second request"]);
  const rounds = out.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => message.content);
  assert.deepEqual(rounds, ["r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12"]);
  assert.equal(out.at(-2)?.content, "third request");
  assert.equal(out.at(-1)?.role === "user" && out.at(-1)?.content, "Files changed:\n- a.ts (+1 -0)");
  assert.ok(!contents(out).some((text) => text.startsWith("old ") || text.includes("agent report")));
  assert.equal(out.filter(is_user_voice).length, 4);
});

test("the oldest kept rounds drop until the recent rounds fit in 30 percent of the window", () => {
  const history: ApiMessage[] = [{ role: "user", instruction: true, content: "go" }];
  for (let index = 1; index <= 10; index += 1) {
    history.push(...round(index, 400));
  }
  const out = compacted_messages({ note: "n", facts: "", audience: "user", history, model });
  const rounds = out.filter((message) => message.role === "assistant");
  assert.ok(rounds.length >= 1 && rounds.length < 10);
  assert.equal(rounds.at(-1)?.content, "r10");
  assert.ok(estimate_request(out.slice(2), []) <= model.context_length * 0.3);
  assert.equal(out.at(-1)?.role, "tool");
  assert.equal(out[1]?.content, "go");
});

test("the newest round stays whole even when its tool outputs alone exceed the 30 percent budget", () => {
  const history: ApiMessage[] = [{ role: "user", instruction: true, content: "go" }, ...round(1, 40), ...round(2, 40), ...round(3, 4000)];
  const out = compacted_messages({ note: "n", facts: "", audience: "user", history, model });
  assert.deepEqual(contents(out.slice(1)), ["go", "r3", "x".repeat(4000)]);
  assert.ok(estimate_request(out.slice(2), []) > model.context_length * 0.3);
});

test("the budget and the ten-round count apply to the older rounds behind the newest one", () => {
  const history: ApiMessage[] = [{ role: "user", instruction: true, content: "go" }];
  for (let index = 1; index <= 6; index += 1) {
    history.push(...round(index, 400));
  }
  history.push(...round(7, 8));
  const out = compacted_messages({ note: "n", facts: "", audience: "user", history, model });
  const rounds = out.filter((message) => message.role === "assistant").map((message) => message.content);
  assert.equal(rounds.at(-1), "r7");
  assert.ok(rounds.length >= 2 && rounds.length < 7, String(rounds.length));
  assert.deepEqual(rounds, Array.from({ length: rounds.length }, (_, index) => `r${8 - rounds.length + index}`));
  assert.ok(estimate_request(out.slice(2), []) <= model.context_length * 0.3);
  const many: ApiMessage[] = [{ role: "user", instruction: true, content: "go" }];
  for (let index = 1; index <= 14; index += 1) {
    many.push(...round(index, index === 14 ? 4000 : 8));
  }
  const capped = compacted_messages({ note: "n", facts: "", audience: "user", history: many, model: { ...model, context_length: 1_000_000 } });
  assert.deepEqual(capped.filter((message) => message.role === "assistant").map((message) => message.content), ["r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12", "r13", "r14"]);
});

test("user messages before the kept rounds stay, app events there drop, and everything after the newest round stays", () => {
  const history: ApiMessage[] = [
    { role: "user", instruction: true, content: "first" },
    ...round(1, 400),
    { role: "user", content: "[Internal app event, not a user message. agent report]" },
    { role: "user", steer: true, content: "steer while working" },
    ...round(2, 4000),
    { role: "user", content: "[Internal app event, not a user message. background task]" },
    { role: "user", instruction: true, content: "next request" },
  ];
  const out = compacted_messages({ note: "n", facts: "", audience: "user", history, model });
  assert.deepEqual(contents(out.slice(1)), [
    "first",
    "steer while working",
    "r2",
    "x".repeat(4000),
    "[Internal app event, not a user message. background task]",
    "next request",
  ]);
  assert.equal(out.filter(is_user_voice).length, 3);
});

test("a sub-agent note keeps its findings and marks the delegated task, and reasoning bound to the prefix is dropped", () => {
  const request = compaction_request("agent");
  assert.match(request, /TASK: the task the main agent gave you/);
  assert.match(request, /\(delegated task\)/);
  assert.match(request, /FINDINGS: everything you found so far that belongs in your report, with file and line\./);
  assert.doesNotMatch(compaction_request("user"), /FINDINGS/);
  assert.match(compaction_request("user"), /Mark the user's with \(user\)\./);
  const history: ApiMessage[] = [{ role: "user", instruction: true, content: "task" }, { role: "assistant", content: "done", reasoning_details: [{ type: "reasoning.text", text: "r" }] }];
  const out = compacted_messages({ note: "n", facts: "", audience: "agent", history, model: { ...model, id: "anthropic/claude-x" } });
  assert.equal(out[0]?.content, `${resume_text("agent")}\n\nn`);
  const assistant = out.find((message) => message.role === "assistant");
  assert.equal(assistant?.role === "assistant" && assistant.reasoning_details, undefined);
});

test("a user context limit and compaction percent replace the model window and the 70% trigger", () => {
  const big: ModelEntry = { ...model, id: "big", context_length: 1_050_000 };
  const limited = with_context_setting(big, { limit: 272_000, compact_percent: 60 });
  assert.equal(limited.context_length, 272_000);
  assert.equal(limited.compact_at, 0.6);
  assert.equal(compaction_due(163_000, 0, limited), false);
  assert.equal(compaction_due(163_300, 0, limited), true);
  assert.equal(with_context_setting(big, { limit: 2_000_000, compact_percent: 70 }).context_length, 1_050_000);
  assert.equal(with_context_setting(big, { limit: null, compact_percent: 80 }).context_length, 1_050_000);
  assert.equal(with_context_setting(big, undefined), big);
  assert.equal(compaction_due(735_001, 0, big), true);
});

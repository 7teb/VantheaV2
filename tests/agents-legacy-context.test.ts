import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { mark_task_prompts } from "../electron/agents/legacy-context.ts";
import { inbox_note, reminder_note } from "../electron/agents/prompt.ts";
import { begin_run, create_agent, init_agent_store, load_context } from "../electron/agents/store.ts";
import { compacted_messages } from "../electron/context/compact.ts";
import type { ApiMessage, ApiUserMessage } from "../electron/model/types.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-legacy-"));
  await init_agent_store(path.join(root, "agents"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

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

const call = (id: string): ApiMessage => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }] });

const legacy: ApiMessage[] = [
  { role: "user", content: "Find why the build divides by zero." },
  call("c1"),
  { role: "tool", tool_call_id: "c1", content: "const a = 1 / 0;" },
  { role: "user", content: reminder_note(15).content },
  { role: "user", content: inbox_note("Also check src/b.ts.").content },
  { role: "assistant", content: "Report: src/a.ts:3 divides by zero." },
  { role: "user", content: "Now fix it." },
  call("c2"),
  { role: "tool", tool_call_id: "c2", content: "ok" },
  { role: "user", tool_images: true, content: [{ type: "text", text: "shot" }] },
  { role: "user", content: "Your last message hit the model's maximum output length and was cut off." },
  { role: "assistant", content: "Fixed." },
];

const marked = (messages: ApiMessage[]) => messages.flatMap((message) => (message.role === "user" && message.instruction ? [String(message.content).slice(0, 40)] : []));

test("an older agent context gets its task prompts and main agent messages marked as instructions", () => {
  const out = mark_task_prompts(legacy, ["Now fix it."]);
  assert.deepEqual(marked(out), ["Find why the build divides by zero.", inbox_note("Also check src/b.ts.").content.slice(0, 40), "Now fix it."]);
  const later = Array.from({ length: 10 }, (_, index) => call(`x${index}`));
  const kept = compacted_messages({ note: "n", facts: "", audience: "agent", history: [...out, ...later], model });
  assert.ok(kept.some((message) => message.content === "Find why the build divides by zero."));
  assert.ok(kept.some((message) => message.content === "Now fix it."));
});

test("a context that already carries marks or a compaction note is left as it is", () => {
  const current: ApiMessage[] = [{ role: "user", instruction: true, content: "task" }, { role: "user", content: "Your last message hit the model's maximum output length." }];
  assert.equal(mark_task_prompts(current, []), current);
  const compacted: ApiMessage[] = [{ role: "user", compaction: true, content: "Context compacted." }, { role: "user", content: "x" }];
  assert.equal(mark_task_prompts(compacted, ["x"]), compacted);
});

test("loading a stored context marks the prompts of the agent's runs", async () => {
  const agent = create_agent({ chat_id: "chat-legacy", name: "Scout", description: "d", topic: "", scope: [], model: "m", effort: "", profile: "explore", without_tools: [], project_root: "C:/p" });
  begin_run(agent, "Find why the build divides by zero.", "parent");
  begin_run(agent, "Now fix it.", "parent");
  const file = path.join(root, "agents", agent.agent_id, "context.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(legacy), "utf8");
  const loaded = await load_context(agent);
  assert.deepEqual(
    loaded.filter((message): message is ApiUserMessage => message.role === "user" && Boolean(message.instruction)).map((message) => message.content),
    ["Find why the build divides by zero.", inbox_note("Also check src/b.ts.").content, "Now fix it."],
  );
});

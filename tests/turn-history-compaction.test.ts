import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Attachment, ChatSummary, Message, Step, TurnStatus, UserMessage } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { compacted_messages } from "../electron/context/compact.ts";
import { init_media } from "../electron/media/files.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import type { ImageReader } from "../electron/turn/user-input.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-history-compaction-"));
  init_media({ attachments: path.join(root, "attachments"), images: path.join(root, "images") });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const model = (context_length: number): ModelEntry => ({
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: true,
  context_length,
  max_output: 4096,
  reasoning_passback: false,
});

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-12T10:00:00.000Z" });

const assistant = (id: string, steps: Step[], status: TurnStatus = "done"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:01.000Z",
  ended_at: "2026-10-12T10:00:05.000Z",
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: status === "failed" ? { kind: "provider_unavailable", message: "OpenRouter 503: down" } : null,
  context: null,
  last_seq: 5,
});

const work = (index: number): Step[] => [
  { id: `text:${index}`, round: 0, kind: "text", text: `turn ${index}` },
  {
    id: `tool:${index}`,
    round: 0,
    kind: "tool",
    index: 0,
    call_id: `c${index}`,
    name: "browser_screenshot",
    args: {},
    status: "done",
    progress: null,
    approval: null,
    view: null,
    error: null,
    result_text: `result ${index}`,
    images: [{ id: `img_shot_${index}.jpg`, label: `shot ${index}` }],
    started_at: 1,
    ended_at: 2,
  },
];

const recording_reader = () => {
  const reads: string[] = [];
  const read: ImageReader = async (id) => {
    reads.push(id);
    return `data:image/jpeg;base64,${Buffer.from(id).toString("base64")}`;
  };
  return { reads, read };
};

const texts = (messages: ApiMessage[]) => messages.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));

const compaction_only = (id: string, status: TurnStatus): AssistantMessage =>
  assistant(id, [{ id: "compaction:0", round: 0, kind: "compaction", status: status === "done" ? "done" : status === "failed" ? "failed" : "interrupted", source: "manual" }], status);

test("a compaction-only turn that failed, stopped or was interrupted adds no note about the previous turn", async () => {
  for (const status of ["failed", "stopped", "interrupted"] as const) {
    const messages: Message[] = [user("u1", "go"), compaction_only("a1", status), user("u2", "next")];
    const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: model(1_000_000) }, recording_reader().read);
    assert.deepEqual(texts(out), ["sys", "go", "next"], status);
  }
  const worked: Message[] = [user("u1", "go"), assistant("a1", work(1), "failed"), user("u2", "next")];
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: worked, model: model(1_000_000) }, recording_reader().read);
  assert.ok(texts(out).includes("[The previous turn failed: OpenRouter 503: down.]"));
  const empty: Message[] = [user("u1", "go"), assistant("a1", [], "interrupted"), user("u2", "next")];
  const empty_out = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages: empty, model: model(1_000_000) }, recording_reader().read);
  assert.ok(texts(empty_out).includes("[The previous turn was interrupted before it finished.]"));
});

const steer_image: Attachment = { id: "img_steer_1.png", kind: "image", name: "steer.png", mime: "image/png", size: 10, vision_note: null };

const long_chat = (turns: number): Message[] => {
  const messages: Message[] = [user("u0", "the request")];
  for (let index = 1; index <= turns; index += 1) {
    const steps = work(index);
    if (index === 2) {
      steps.unshift({ id: "steer:2", round: 0, kind: "steer", text: "keep the old layout", attachments: [steer_image] });
    }
    messages.push(assistant(`a${index}`, steps));
  }
  return messages;
};

const replay_then_compact = async (messages: Message[], summary: ChatSummary, entry: ModelEntry): Promise<ApiMessage[]> => {
  const full = await build_api_messages({ system: "sys", agent_tools: true, summary: null, messages, model: entry }, recording_reader().read);
  return [full[0] as ApiMessage, ...compacted_messages({ note: summary.text, facts: summary.facts ?? "", audience: "user", history: full.slice(1), model: entry })];
};

test("with a stored summary only the kept rounds are replayed, so dropped screenshots are never read", async () => {
  const messages = long_chat(14);
  const summary: ChatSummary = { text: "TASK: t", through_message_id: "a14", through_round: 0, facts: "" };
  const { reads, read } = recording_reader();
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary, messages, model: model(1_000_000) }, read);
  assert.deepEqual(reads.filter((id) => id.startsWith("img_shot_")), Array.from({ length: 10 }, (_, index) => `img_shot_${index + 5}.jpg`));
  assert.ok(reads.includes("img_steer_1.png"));
  assert.deepEqual(out, await replay_then_compact(messages, summary, model(1_000_000)));
});

test("when the 30 percent budget keeps fewer rounds, the replay still matches replaying everything and compacting", async () => {
  const messages = long_chat(8);
  const summary: ChatSummary = { text: "TASK: t", through_message_id: "a8", through_round: 0 };
  const entry = model(17_000);
  const { reads, read } = recording_reader();
  const out = await build_api_messages({ system: "sys", agent_tools: true, summary, messages, model: entry }, read);
  const kept = reads.filter((id) => id.startsWith("img_shot_"));
  assert.ok(kept.length >= 1 && kept.length < 8);
  assert.equal(kept.at(-1), "img_shot_8.jpg");
  assert.deepEqual(out, await replay_then_compact(messages, summary, entry));
});

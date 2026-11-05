import type { CompactionStep } from "../shared/chat.ts";
import { sent_estimate } from "../electron/context/calibration.ts";
import { compaction_request } from "../electron/context/compact-text.ts";
import type { ApiMessage, RoundRequest, RoundResult, RoundUsage } from "../electron/model/types.ts";
import type { CompactionRecord, StreamFn } from "../electron/turn/session.ts";
import { harness, make_tool, model, transcript, type Harness } from "./turn-loop-harness.ts";

export const small = { ...model, context_length: 10_000 };

export const counted = (request: RoundRequest, ratio: number): RoundUsage => ({
  prompt_tokens: Math.round(sent_estimate(request.messages, request.tools, request.model) * ratio),
  completion_tokens: 50,
  reasoning_tokens: 0,
});

export type Recorded = { request: RoundRequest; messages: ApiMessage[] };

export const recording = (answer: (request: RoundRequest, call: number) => Promise<RoundResult> | RoundResult) => {
  const calls: Recorded[] = [];
  const stream: StreamFn = async (request) => {
    calls.push({ request, messages: request.messages.map((message) => ({ ...message })) });
    return answer(request, calls.length);
  };
  return { calls, stream };
};

export type Setup = { h: Harness; saved: CompactionRecord[]; sleeps: number[] };

export const setup = (stream: StreamFn, tool_text: string): Setup => {
  const read = make_tool("read_file", async () => ({ status: "done", text: tool_text, view: null }));
  const h = harness(stream, [read]);
  const saved: CompactionRecord[] = [];
  const sleeps: number[] = [];
  h.session.model = small;
  h.session.compaction = {
    audience: "user",
    facts: async () => "Files changed:\n- C:/p/a.ts (+1 -0)",
    save: async (record) => void saved.push(record),
    sleep: async (ms) => void sleeps.push(ms),
  };
  h.messages.push({ role: "user", instruction: true, content: "fix the bug" });
  return { h, saved, sleeps };
};

export const pad_request = (h: Harness, chars: number) => {
  h.messages[1] = { role: "user", instruction: true, content: `fix the bug ${"r".repeat(chars)}` };
};

export const compaction_steps = (h: Harness) => transcript(h.events).steps.filter((step): step is CompactionStep => step.kind === "compaction");

const note_end = compaction_request("user").split("\n\n").at(-1) ?? "";

export const is_note_call = (request: RoundRequest) => {
  const last = request.messages.at(-1);
  return last?.role === "user" && typeof last.content === "string" && last.content.endsWith(note_end);
};

import type { ChatSummary, Message } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import type { Emitter } from "../turn/session.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";

const compact_fraction = 0.8;

const keep_recent_turns = 3;

const summary_max_tokens = 4000;

const summary_timeout_ms = 60000;

const summarizer_system =
  "You compress the earlier part of an ongoing coding conversation into a compact structured summary, so it can replace the raw earlier messages without losing what matters. Output ONLY the summary, no preamble. Use these sections, each a short terse bullet list, omitting any that would be empty: GOAL, DECISIONS, CHANGED FILES, STATE, OPEN. Keep file paths, function names and key identifiers verbatim. Be specific but brief. Never invent anything not in the input, and do not include raw code blocks or long quotes.";

const tool_snippet = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 240);

export const render_turn = (message: Message): string => {
  if (message.role === "user") {
    return `USER: ${message.text.slice(0, 8000)}`;
  }
  const lines: string[] = [];
  for (const step of message.steps) {
    if (step.kind === "text") {
      lines.push(step.text);
    } else if (step.kind === "tool") {
      lines.push(`[tool ${step.name}: ${tool_snippet(step.result_text)}]`);
    }
  }
  return `ASSISTANT: ${lines.join("\n").slice(0, 8000)}`;
};

export const render_turns = (messages: Message[]): string => messages.map(render_turn).join("\n\n");

export type CompactionPlan = { older: Message[]; kept: Message[]; through_message_id: string };

export const needs_compaction = (request_tokens: number, model: ModelEntry): boolean =>
  model.context_length > 0 && request_tokens > model.context_length * compact_fraction;

export const plan_compaction = (messages: Message[]): CompactionPlan | null => {
  const user_indices = messages.map((message, index) => (message.role === "user" ? index : -1)).filter((index) => index >= 0);
  if (user_indices.length <= keep_recent_turns) {
    return null;
  }
  const cutoff = user_indices[user_indices.length - keep_recent_turns] ?? messages.length;
  const older = messages.slice(0, cutoff);
  const last = older.at(-1);
  if (!last) {
    return null;
  }
  return { older, kept: messages.slice(cutoff), through_message_id: last.id };
};

const summarize = async (older: Message[], summary: ChatSummary | null, side_model: SideModelCall, signal: AbortSignal): Promise<string> => {
  const prior = summary?.text ? `EXISTING SUMMARY OF EVEN EARLIER MESSAGES (fold its facts in, do not drop them):\n${summary.text}\n\n` : "";
  const messages: SideMessage[] = [
    { role: "system", content: summarizer_system },
    { role: "user", content: `${prior}CONVERSATION MESSAGES TO SUMMARIZE (oldest first):\n${render_turns(older)}` },
  ];
  return (await side_model("summarize", messages, summary_max_tokens, signal)).trim();
};

export type CompactInput = {
  chat_id: string;
  messages: Message[];
  summary: ChatSummary | null;
  round: number;
  emit: Emitter;
  side_model: SideModelCall;
  set_summary: (chat_id: string, summary: ChatSummary) => Promise<void>;
  signal: AbortSignal;
};

export const compact_chat = async (input: CompactInput): Promise<ChatSummary | null> => {
  const plan = plan_compaction(input.messages);
  if (!plan) {
    return null;
  }
  input.emit({ type: "compaction", round: input.round, status: "running", summary: "" });
  try {
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(summary_timeout_ms)]);
    const text = await summarize(plan.older, input.summary, input.side_model, signal);
    if (!text) {
      throw new Error("the summarize model returned an empty summary");
    }
    const summary: ChatSummary = { text, through_message_id: plan.through_message_id };
    await input.set_summary(input.chat_id, summary);
    input.emit({ type: "compaction", round: input.round, status: "done", summary: text });
    return summary;
  } catch (error) {
    console.error(`[context] compacting chat ${input.chat_id} failed:`, error);
    input.emit({ type: "compaction", round: input.round, status: "failed", summary: "" });
    return null;
  }
};

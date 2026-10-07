import fs from "node:fs/promises";
import { agent_status_context, report_event_context } from "../../shared/agent-notes.ts";
import type { Attachment, AssistantMessage, ChatSummary, Message, ReasoningStep, Step, TextStep, ToolStep } from "../../shared/chat.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { report_note_content, update_note_content } from "../agents/reports.ts";
import { cap_text } from "../context/estimate.ts";
import { resolve_media_file } from "../media/files.ts";
import type { ApiAssistantMessage, ApiContentPart, ApiMessage } from "../model/types.ts";
import { render_section } from "../prompts/sections.ts";
import { api_call_id } from "./round.ts";

export type ImageReader = (attachment: Attachment) => Promise<string>;

export type HistoryInput = {
  system: string;
  summary: ChatSummary | null;
  messages: Message[];
  model: ModelEntry;
};

const recent_assistant_turns = 2;

const cap_recent_tokens = 25000;

const cap_old_tokens = 4000;

const default_read_image: ImageReader = async (attachment) => {
  const file = await resolve_media_file("attachment", attachment.id);
  const bytes = await fs.readFile(file);
  return `data:${attachment.mime};base64,${bytes.toString("base64")}`;
};

const system_message = (system: string, summary: ChatSummary | null): ApiMessage => {
  if (!summary) {
    return { role: "system", content: system };
  }
  const section = render_section({
    title: "conversation_summary",
    body: `The start of this conversation was compacted to save context. Treat this as established history, and re-read any file you need rather than guessing its contents.\n\n${summary.text}`,
  });
  return { role: "system", content: `${system}\n\n${section}` };
};

const after_summary = (messages: Message[], summary: ChatSummary | null): Message[] => {
  if (!summary) {
    return messages;
  }
  const at = messages.findIndex((message) => message.id === summary.through_message_id);
  return at < 0 ? messages : messages.slice(at + 1);
};

const file_note = (attachment: Attachment) =>
  `[Attached file "${attachment.name}" (id: ${attachment.id}). Read it with read_attachment using that id.]`;

const image_note = (attachment: Attachment) =>
  attachment.vision_note
    ? `[Attached image "${attachment.name}" (id: ${attachment.id}). Description:\n${attachment.vision_note}]`
    : `[Attached image "${attachment.name}" (id: ${attachment.id}). No description is available; use analyze_image with this id.]`;

export const user_content = async (
  text: string,
  attachments: Attachment[],
  model: ModelEntry,
  read_image: ImageReader = default_read_image,
): Promise<string | ApiContentPart[]> => {
  const notes: string[] = [];
  const images: ApiContentPart[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      if (model.vision) {
        try {
          images.push({ type: "image_url", image_url: { url: await read_image(attachment) } });
        } catch (error) {
          console.error(`[turn] reading image attachment ${attachment.id} failed:`, error);
          notes.push(image_note(attachment));
        }
      } else {
        notes.push(image_note(attachment));
      }
    } else {
      notes.push(file_note(attachment));
    }
  }
  const full = [text, ...notes].filter(Boolean).join("\n\n");
  return images.length ? [{ type: "text", text: full }, ...images] : full;
};

const build_user = async (message: Extract<Message, { role: "user" }>, model: ModelEntry, read_image: ImageReader): Promise<ApiMessage> => ({
  role: "user",
  content: await user_content(message.origin === "agent_report" ? report_event_context(message.text) : message.text, message.attachments, model, read_image),
});

const rounds_of = (steps: Step[]): number[] => {
  const seen: number[] = [];
  for (const step of steps) {
    if (!seen.includes(step.round)) {
      seen.push(step.round);
    }
  }
  return seen;
};

const terminal_note = (message: AssistantMessage): string | null => {
  if (message.status === "interrupted") {
    return "[The previous turn was interrupted before it finished.]";
  }
  if (message.status === "stopped") {
    return "[The user stopped the previous turn before it finished.]";
  }
  if (message.status === "failed") {
    return `[The previous turn failed: ${message.error?.message ?? "unknown error"}.]`;
  }
  return null;
};

const round_reasoning = (message: AssistantMessage, round: number, steps: Step[]): Pick<ApiAssistantMessage, "reasoning_details" | "reasoning"> => {
  const details = message.reasoning_details.find((entry) => entry.round === round)?.details ?? [];
  if (details.length) {
    return { reasoning_details: details };
  }
  const text = steps
    .filter((step): step is ReasoningStep => step.kind === "reasoning")
    .map((step) => step.text)
    .join("");
  return text ? { reasoning: text } : {};
};

type ReplayInput = { cap: number; with_reasoning: boolean; model: ModelEntry; read_image: ImageReader };

const replay_assistant = async (message: AssistantMessage, { cap, with_reasoning, model, read_image }: ReplayInput): Promise<ApiMessage[]> => {
  const out: ApiMessage[] = [];
  for (const round of rounds_of(message.steps)) {
    const steps = message.steps.filter((step) => step.round === round);
    for (const step of steps) {
      if (step.kind === "steer") {
        out.push({ role: "user", content: await user_content(step.text, step.attachments ?? [], model, read_image) });
      } else if (step.kind === "notice" && step.notice === "agent_report") {
        out.push({ role: "user", content: report_note_content(step.text) });
      } else if (step.kind === "notice" && step.notice === "agent_update") {
        out.push({ role: "user", content: update_note_content(step.text) });
      }
    }
    const content = steps
      .filter((step): step is TextStep => step.kind === "text")
      .map((step) => step.text)
      .join("");
    const tools = steps.filter((step): step is ToolStep => step.kind === "tool" && Boolean(step.call_id));
    const assistant: ApiAssistantMessage = {
      role: "assistant",
      content: content || null,
      ...(with_reasoning ? round_reasoning(message, round, steps) : {}),
    };
    if (tools.length) {
      assistant.tool_calls = tools.map((step) => ({
        id: api_call_id(message.id, step.call_id),
        type: "function",
        function: { name: step.name, arguments: JSON.stringify(step.args) },
      }));
    }
    if (content || tools.length) {
      out.push(assistant);
    }
    for (const step of tools) {
      out.push({ role: "tool", tool_call_id: api_call_id(message.id, step.call_id), content: cap_text((step.name === "get_agent_status" ? agent_status_context(step.result_text) : step.result_text) || "[no result]", cap) });
    }
  }
  const note = terminal_note(message);
  if (note) {
    out.push({ role: "user", content: note });
  }
  return out;
};

export const build_api_messages = async (input: HistoryInput, read_image: ImageReader = default_read_image): Promise<ApiMessage[]> => {
  const messages = after_summary(input.messages, input.summary);
  const assistant_indices = messages.map((message, index) => (message.role === "assistant" ? index : -1)).filter((index) => index >= 0);
  const recent_cutoff = assistant_indices.at(-recent_assistant_turns) ?? Number.POSITIVE_INFINITY;
  const out: ApiMessage[] = [system_message(input.system, input.summary)];
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      out.push(await build_user(message, input.model, read_image));
    } else {
      const cap = index >= recent_cutoff ? cap_recent_tokens : cap_old_tokens;
      const with_reasoning = input.model.reasoning_passback && message.model === input.model.id;
      out.push(...(await replay_assistant(message, { cap, with_reasoning, model: input.model, read_image })));
    }
  }
  return out;
};

import { report_event_context } from "../../shared/agent-notes.ts";
import { has_work, instruction_origin, manual_compaction_only, type AssistantMessage, type ChatSummary, type Message, type ReasoningStep, type Step, type StepImage, type TextStep, type ToolStep, type UserMessage } from "../../shared/chat.ts";
import { native_rules } from "../../shared/image-native.ts";
import { parse_peer_alerts } from "../../shared/peer-notes.ts";
import type { ModelEntry } from "../../shared/models.ts";
import { alert_note_content, digest_note_content, report_note_content, update_note_content } from "../agents/reports.ts";
import { compacted_messages, window_meter } from "../context/compact.ts";
import type { ApiAssistantMessage, ApiMessage } from "../model/types.ts";
import { stopped_text } from "../permissions/verdict-text.ts";
import { media_mime } from "../media/files.ts";
import { fitted_image_url } from "../media/fitted-image.ts";
import { carried_todos_content } from "./carried-todos.ts";
import { carrier, not_shown_note, unreadable_note, type CarrierImage } from "./carriers.ts";
import { api_call_id } from "./round.ts";
import { counted_image, steer_message, user_content, type ImageReader } from "./user-input.ts";
import { workflow_note_content } from "../workflows/notice.ts";

export type HistoryInput = {
  system: string;
  summary: ChatSummary | null;
  messages: Message[];
  model: ModelEntry;
  agent_tools: boolean;
};

const awaited_review = (step: ToolStep): boolean => {
  const last = step.reviews?.at(-1);
  return step.status === "cancelled" && last?.verdict === "review" && !step.decisions?.some((decision) => decision.review_id === last.id);
};

const tool_result = (step: ToolStep): string => {
  if (awaited_review(step)) {
    return stopped_text(step.reviews?.at(-1)?.tool.startsWith("mcp:") ? "tool call" : "command");
  }
  return step.result_text || "[no result]";
};

type Region = { compacted: Message[]; rest: Message[] };

const split_region = (messages: Message[], summary: ChatSummary): Region | null => {
  const at = messages.findIndex((message) => message.id === summary.through_message_id);
  const through = messages[at];
  if (!through) {
    return null;
  }
  const round = summary.through_round;
  if (round === undefined || through.role !== "assistant") {
    return { compacted: messages.slice(0, at + 1), rest: messages.slice(at + 1) };
  }
  const head: AssistantMessage = { ...through, status: "done", steps: through.steps.filter((step) => step.round <= round) };
  const tail: AssistantMessage = { ...through, steps: through.steps.filter((step) => step.round > round) };
  return { compacted: [...messages.slice(0, at), head], rest: [tail, ...messages.slice(at + 1)] };
};

export const uncompacted_work = (messages: Message[], summary: ChatSummary | null): boolean =>
  (summary ? (split_region(messages, summary)?.rest ?? messages) : messages).some(has_work);

const event_text = (message: UserMessage, agent_tools: boolean): string => {
  if (message.origin === "agent_report") {
    return report_event_context(message.text, agent_tools);
  }
  return message.origin === "workflow" ? workflow_note_content(message.text) : message.text;
};

const build_user = async (message: UserMessage, model: ModelEntry, read_image: ImageReader, agent_tools: boolean): Promise<ApiMessage> => ({
  role: "user",
  ...(instruction_origin(message.origin) ? { instruction: true as const } : {}),
  content: await user_content(event_text(message, agent_tools), message.attachments, model, read_image),
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

const replay_image = async (image: StepImage, model: ModelEntry, read_image: ImageReader): Promise<CarrierImage> => {
  if (!model.vision) {
    return { label: image.label, note: not_shown_note };
  }
  try {
    return { label: image.label, url: await read_image(image.id, media_mime(image.id), native_rules(model)) };
  } catch (error) {
    console.error(`[turn] reading tool image ${image.id} failed:`, error);
    return { label: image.label, note: unreadable_note };
  }
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

type ReplayInput = { with_reasoning: boolean; model: ModelEntry; read_image: ImageReader; agent_tools: boolean };

const all_rounds = Number.NEGATIVE_INFINITY;

const no_rounds = Number.POSITIVE_INFINITY;

const lead_messages = async (steps: Step[], { model, read_image, agent_tools }: ReplayInput, voice_only: boolean): Promise<ApiMessage[]> => {
  const out: ApiMessage[] = [];
  for (const step of steps) {
    if (step.kind === "steer") {
      out.push(await steer_message(step.text, step.attachments ?? [], model, read_image));
      continue;
    }
    if (voice_only || step.kind !== "notice") {
      continue;
    }
    if (step.notice === "agent_report") {
      out.push({ role: "user", content: report_note_content(step.text, agent_tools) });
    } else if (step.notice === "agent_update") {
      out.push({ role: "user", content: parse_peer_alerts(step.text).length ? alert_note_content(step.text) : update_note_content(step.text) });
    } else if (step.notice === "peer_digest") {
      out.push({ role: "user", content: digest_note_content(step.text) });
    } else if (step.notice === "workflow_result") {
      out.push({ role: "user", content: workflow_note_content(step.text) });
    } else if (step.notice === "todos_carried") {
      out.push({ role: "user", content: carried_todos_content(step.text) });
    }
  }
  return out;
};

const replay_round = async (message: AssistantMessage, round: number, steps: Step[], input: ReplayInput): Promise<ApiMessage[]> => {
  const { with_reasoning, model, read_image } = input;
  const out = await lead_messages(steps, input, false);
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
    out.push({ role: "tool", tool_call_id: api_call_id(message.id, step.call_id), content: tool_result(step) });
  }
  const shots = tools.flatMap((step) => step.images ?? []);
  if (shots.length) {
    const images: CarrierImage[] = [];
    for (const image of shots) {
      images.push(await replay_image(image, model, read_image));
    }
    out.push(carrier(images));
  }
  return out;
};

type RoundReplay = { round: number; messages: ApiMessage[] };

type MessageReplay = { rounds: RoundReplay[]; tail: ApiMessage[] };

const replay_assistant = async (message: AssistantMessage, input: ReplayInput, from_round: number): Promise<MessageReplay> => {
  const rounds: RoundReplay[] = [];
  for (const round of rounds_of(message.steps)) {
    const steps = message.steps.filter((step) => step.round === round);
    rounds.push({ round, messages: round < from_round ? await lead_messages(steps, input, true) : await replay_round(message, round, steps, input) });
  }
  const note = manual_compaction_only(message) ? null : terminal_note(message);
  return { rounds, tail: note ? [{ role: "user", content: note }] : [] };
};

type ReplayContext = { input: HistoryInput; read_image: ImageReader };

const replay_message = async (message: Message, { input, read_image }: ReplayContext, from_round: number): Promise<MessageReplay> => {
  if (message.role === "user") {
    const skipped = from_round === no_rounds && !instruction_origin(message.origin);
    return { rounds: [], tail: skipped ? [] : [await build_user(message, input.model, read_image, input.agent_tools)] };
  }
  const with_reasoning = input.model.reasoning_passback && message.model === input.model.id;
  return replay_assistant(message, { with_reasoning, model: input.model, read_image, agent_tools: input.agent_tools }, from_round);
};

type Cut = { index: number; round: number };

const whole: Cut = { index: -1, round: all_rounds };

const from_round = (index: number, cut: Cut): number => {
  if (index < cut.index) {
    return no_rounds;
  }
  return index === cut.index ? cut.round : all_rounds;
};

const replay_messages = async (messages: Message[], context: ReplayContext, cut: Cut = whole): Promise<ApiMessage[]> => {
  const out: ApiMessage[] = [];
  for (const [index, message] of messages.entries()) {
    const replayed = await replay_message(message, context, from_round(index, cut));
    out.push(...replayed.rounds.flatMap((entry) => entry.messages), ...replayed.tail);
  }
  return out;
};

const window_cut = async (messages: Message[], context: ReplayContext): Promise<Cut> => {
  const take = window_meter(context.input.model);
  const counting: ReplayContext = { ...context, read_image: counted_image };
  let cut: Cut = { index: messages.length, round: all_rounds };
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const replayed = await replay_message(messages[index], counting, all_rounds);
    if (replayed.tail.toReversed().some((message) => take(message) === "full")) {
      return cut;
    }
    for (const { round, messages: part } of replayed.rounds.toReversed()) {
      for (const message of part.toReversed()) {
        const step = take(message);
        if (step === "full") {
          return cut;
        }
        if (step === "round") {
          cut = { index, round };
        }
      }
    }
  }
  return cut;
};

export const build_api_messages = async (input: HistoryInput, read_image: ImageReader = fitted_image_url): Promise<ApiMessage[]> => {
  const system: ApiMessage = { role: "system", content: input.system };
  const summary = input.summary;
  const region = summary ? split_region(input.messages, summary) : null;
  const context: ReplayContext = { input, read_image };
  if (!summary || !region) {
    return [system, ...(await replay_messages(input.messages, context))];
  }
  const history = await replay_messages(region.compacted, context, await window_cut(region.compacted, context));
  const compacted = compacted_messages({ note: summary.text, facts: summary.facts ?? "", audience: "user", history, model: input.model });
  return [system, ...compacted, ...(await replay_messages(region.rest, context))];
};

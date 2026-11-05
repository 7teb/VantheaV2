import { apply_events } from "../shared/apply-event.ts";
import type { AssistantMessage, ChatSummary, ContextUsage, Message, UserOrigin } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import { sent_estimate, stored_context } from "../electron/context/calibration.ts";
import { parse_body } from "../electron/chats/files.ts";
import { settle_streaming } from "../electron/chats/settle.ts";
import type { ApiMessage, RoundRequest, RoundResult } from "../electron/model/types.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_compaction_turn, run_turn_loop } from "../electron/turn/loop.ts";
import type { StreamFn, TurnSession } from "../electron/turn/session.ts";
import { counted, is_note_call, type Recorded } from "./turn-compaction-harness.ts";
import { completed, harness, make_tool, model, type Harness } from "./turn-loop-harness.ts";

export const window_model = (id: string, context_length = 10_000): ModelEntry => ({ ...model, id, context_length });

export type ChatState = { messages: Message[]; summary: ChatSummary | null };

export const new_chat = (): ChatState => ({ messages: [], summary: null });

let sequence = 0;

export const ask = (chat: ChatState, text: string, origin: UserOrigin = "user") => {
  sequence += 1;
  chat.messages.push({ id: `u${sequence}`, role: "user", text, attachments: [], origin, created_at: "2026-10-12T10:00:00.000Z" });
};

const placeholder = (id: string, model_id: string): AssistantMessage => ({
  id,
  role: "assistant",
  model: model_id,
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:01.000Z",
  ended_at: null,
  status: "streaming",
  steps: [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

export type Answer = (request: RoundRequest, working: number) => Partial<RoundResult>;

export const provider = (ratio: number, answer: Answer) => {
  const calls: Recorded[] = [];
  let working = 0;
  const stream: StreamFn = async (request, callbacks) => {
    calls.push({ request, messages: request.messages.map((message) => ({ ...message })) });
    if (is_note_call(request)) {
      return completed({ content: "TASK: t" });
    }
    working += 1;
    const result = completed({ usage: counted(request, ratio), ...answer(request, working) });
    if (result.content) {
      callbacks.on_text(result.content);
    }
    return result;
  };
  return { calls, stream };
};

export type TurnOptions = {
  tool_text?: string;
  compact_only?: boolean;
  prepare?: (h: Harness) => void;
  keep?: (events: StreamEventBody[]) => StreamEventBody[];
};

export type TurnRun = { message: AssistantMessage; events: StreamEventBody[]; session: TurnSession; api: ApiMessage[] };

export const run_chat_turn = async (chat: ChatState, turn_model: ModelEntry, stream: StreamFn, options: TurnOptions = {}): Promise<TurnRun> => {
  sequence += 1;
  const message_id = `a${sequence}`;
  const read = make_tool("read_file", async () => ({ status: "done", text: options.tool_text ?? "ok", view: null }));
  const h = harness(stream, [read]);
  h.session.model = turn_model;
  h.session.message_id = message_id;
  h.session.stored_context = stored_context(chat.messages, turn_model.id);
  h.session.compaction = {
    audience: "user",
    facts: async () => "",
    save: async ({ note, facts, through_round }) => {
      chat.summary = { text: note, through_message_id: message_id, through_round, facts };
    },
    sleep: async () => undefined,
  };
  options.prepare?.(h);
  const api = await build_api_messages({ system: "sys", summary: chat.summary, messages: chat.messages, model: turn_model, agent_tools: false });
  await (options.compact_only ? run_compaction_turn(h.session, api) : run_turn_loop(h.session, api));
  const kept = options.keep ? options.keep(h.events) : h.events;
  const message = apply_events(
    placeholder(message_id, turn_model.id),
    kept.map((body, index) => ({ ...body, seq: index + 1, at: index + 1 })),
  );
  chat.messages.push(message);
  return { message, events: h.events, session: h.session, api };
};

export const reload_from_disk = (chat: ChatState): ChatState => {
  const body = parse_body(JSON.parse(JSON.stringify({ summary: chat.summary, messages: chat.messages, questions: {} })), "chat-calibration");
  if (!body) {
    throw new Error("the stored chat did not parse");
  }
  return { messages: settle_streaming(body.messages, 99) ?? body.messages, summary: body.summary };
};

export const contexts = (events: StreamEventBody[]): ContextUsage[] => events.flatMap((event) => (event.type === "context" ? [event.usage] : []));

export const scale_of = (usage: ContextUsage) => (usage.calibration ? usage.calibration.prompt_tokens / usage.calibration.estimate : 1);

export const measured = (call: Recorded, ratio: number) => Math.ceil(sent_estimate(call.messages, call.request.tools, call.request.model) * ratio);

export const working_calls = (calls: Recorded[]) => calls.filter((call) => !is_note_call(call.request));

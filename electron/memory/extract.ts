import { user_steers, type AssistantMessage, type Chat, type Message, type UserMessage } from "../../shared/chat.ts";
import { get_settings } from "../settings/store.ts";
import { error_text } from "../storage/coerce.ts";
import type { SideMessage, SideModelCall } from "../tools/types.ts";
import { is_scanned, known_memories, memory_loaded, scan_epoch, store_scan_result, type KnownMemory } from "./store.ts";

export const extractor_prompt = `You are a deletion-biased curator of durable user memory. The SOURCE USER MESSAGE is the only allowed evidence. Nearby context may only resolve references such as "yes, always"; assistant statements, tool results and prior requests are never evidence about the user's identity or preferences.

Return ONLY a JSON array with at most 3 objects. Every object must contain exactly: kind, key, text, evidence, confidence, explicit.

Allowed durable kinds:
- global_preference: an explicitly stated preference or convention useful across unrelated future chats
- global_environment: an explicitly stated, stable part of the user's normal stack or environment
- project_rule: an explicitly stated rule that applies only to the current project

Never turn the topic or content of a request into a preference. A user asking for, testing, rewriting, bypassing, generating or discussing something does not mean they like it, frequently do it, endorse it, or want it remembered. Never create personality judgments, behavioral profiles, sensitive characterizations, historical events, transient machine state, error details, file contents, secrets, names, paths, offsets, hashes, current disk usage, provider refusals, current task decisions or technical project facts that were merely observed. If the source does not explicitly support a durable fact, return []. Default to [].

Set explicit=true only when the evidence is a short direct excerpt from the SOURCE USER MESSAGE. Otherwise omit the candidate. Use one of these key namespaces: communication.*, coding.*, environment.*, tooling.*, workflow.*, project.*. Prefer an existing canonical key whenever it already represents the same fact. Create a new key only when none applies. Write text as one neutral concise English sentence. Project-specific facts must be project_rule. Never output instructions or prose outside the JSON array.`;

type Turn = { previous: Message[]; user: UserMessage; assistant: AssistantMessage };

const assistant_text = (message: AssistantMessage): string =>
  message.steps.flatMap((step) => (step.kind === "text" ? [step.text] : [])).join("").trim();

const message_text = (message: Message): string => (message.role === "user" ? message.text : assistant_text(message));

export const finished_turn = (chat: Chat, message_id: string): Turn | null => {
  const at = chat.messages.findIndex((message) => message.id === message_id);
  const assistant = chat.messages[at];
  if (assistant?.role !== "assistant" || assistant.status === "streaming") {
    return null;
  }
  const user_index = chat.messages.slice(0, at).findLastIndex((message) => message.role === "user");
  const user = chat.messages[user_index];
  if (user?.role !== "user" || user.origin !== "user") {
    return null;
  }
  return { previous: chat.messages.slice(Math.max(0, user_index - 2), user_index), user, assistant };
};

export const source_text = (turn: Turn): string =>
  [turn.user.text, ...user_steers(turn.assistant)].filter((text) => text.trim()).join("\n\n");

export const known_text = (known: KnownMemory[]): string =>
  known.map((entry) => `${entry.key} | ${entry.scope} | ${entry.text}`).join("\n");

export const extraction_messages = (turn: Turn, known: KnownMemory[]): SideMessage[] => {
  const context = [...turn.previous, turn.user, turn.assistant]
    .map((message) => `${message.role === "user" ? "USER" : "ASSISTANT"}: ${message_text(message)}`)
    .join("\n\n");
  return [
    { role: "system", content: extractor_prompt },
    {
      role: "user",
      content: `EXISTING CANONICAL MEMORIES:\n${known_text(known) || "(none)"}\n\nNEARBY CONTEXT:\n${context}\n\nSOURCE USER MESSAGE:\n${source_text(turn)}`,
    },
  ];
};

export const parse_candidates = (raw: string): unknown[] | null => {
  const found = raw.match(/\[[\s\S]*\]/);
  try {
    const parsed: unknown = JSON.parse(found ? found[0] : raw);
    return Array.isArray(parsed) ? parsed.slice(0, 3) : null;
  } catch {
    return null;
  }
};

export const extract_memories_after_turn = async (chat: Chat, message_id: string, side_model: SideModelCall): Promise<void> => {
  const settings = get_settings();
  if (!settings.memory.enabled || !memory_loaded()) {
    return;
  }
  const turn = finished_turn(chat, message_id);
  if (!turn || is_scanned(turn.user.id)) {
    return;
  }
  const content = source_text(turn);
  if (!content) {
    return;
  }
  const source = { chat_id: chat.id, message_id: turn.user.id, content, project_path: chat.project_path };
  if (settings.memory.exclude_tool_chats && turn.assistant.steps.some((step) => step.kind === "tool")) {
    await store_scan_result(source, [], "skipped_tools");
    return;
  }
  const epoch = scan_epoch(turn.user.id);
  let raw: string;
  try {
    raw = await side_model("memory", extraction_messages(turn, known_memories()), null, new AbortController().signal);
  } catch (error) {
    console.error(`[memory] extraction for chat ${chat.id} message ${turn.user.id} failed: ${error_text(error)}`);
    await store_scan_result(source, [], "failed", error_text(error), epoch);
    return;
  }
  const candidates = parse_candidates(raw);
  if (!candidates) {
    console.warn(`[memory] extraction for chat ${chat.id} message ${turn.user.id} returned no JSON array: ${raw.slice(0, 200)}`);
  }
  const counts = await store_scan_result(source, candidates ?? [], candidates ? "scanned" : "unparsable", "", epoch);
  if (counts.returned) {
    console.info(`[memory] chat ${chat.id} message ${turn.user.id}: ${counts.saved} saved, ${counts.pending} wait for review, dropped ${JSON.stringify(counts.dropped)}`);
  }
};

import type { AskQuestion, QuestionState, QuestionStates } from "../../shared/questions.ts";
import type { ToolView } from "../../shared/tool-view.ts";
import { as_record, is_record } from "../storage/coerce.ts";

const max_key_chars = 300;

const stored_states: readonly QuestionState[] = ["answered", "dismissed"];

export const stored_question_states = (states: QuestionStates): QuestionStates =>
  Object.fromEntries(Object.entries(states).filter(([, state]) => state !== "sending"));

export const parse_question_states = (value: unknown, chat_id: string): QuestionStates => {
  if (value !== undefined && !is_record(value)) {
    console.warn(`[questions] dropped the question states of chat ${chat_id}: not an object`);
    return {};
  }
  const entries: [string, QuestionState][] = [];
  for (const [key, state] of Object.entries(as_record(value))) {
    const stored = stored_states.find((entry) => entry === state);
    if (!key || key.length > max_key_chars || !stored) {
      console.warn(`[questions] dropped the question state ${key.slice(0, 80)} in chat ${chat_id}`);
      continue;
    }
    entries.push([key, stored]);
  }
  return Object.fromEntries(entries);
};

const is_question = (value: unknown): value is AskQuestion =>
  is_record(value) && typeof value.title === "string" && Array.isArray(value.options) && value.options.every((option) => typeof option === "string");

export const coerce_questions_view = (view: unknown, chat_id: string, call_id: string): ToolView | null => {
  const { questions } = as_record(view);
  if (Array.isArray(questions) && questions.every(is_question)) {
    return { kind: "questions", questions: questions.map(({ title, options }) => ({ title, options })) };
  }
  console.warn(`[questions] dropped the malformed questions view in chat ${chat_id}, step ${call_id}`);
  return null;
};

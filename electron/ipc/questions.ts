import type { QuestionAnswer } from "../../shared/questions.ts";
import { dismiss_questions } from "../questions/answers.ts";
import { answer_questions } from "../questions/deliver.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

const max_entries = 50;

const chat_id_of = (value: unknown) => require_string(value, "chat id", 200);

const id_of = (value: unknown) => require_string(value, "question id", 300);

const list_of = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value) || value.length > max_entries) {
    throw new Error(`${label} must be a list of at most ${max_entries} entries`);
  }
  return value;
};

const require_unique = (ids: string[]): void => {
  if (new Set(ids).size !== ids.length) {
    throw new Error("question ids must be unique");
  }
};

const parse_answer = (value: unknown): QuestionAnswer => {
  const raw = require_record(value, "answer");
  return { id: id_of(raw.id), answer: require_string(raw.answer, "answer text", 200_000) };
};

const parse_answers = (value: unknown): QuestionAnswer[] => {
  const answers = list_of(value, "answers").map(parse_answer);
  require_unique(answers.map((entry) => entry.id));
  return answers;
};

const parse_ids = (value: unknown): string[] => {
  const ids = list_of(value, "question ids").map(id_of);
  require_unique(ids);
  return ids;
};

export const register_questions_ipc = () => {
  handle("questions:answer", (chat_id, answers) => answer_questions(chat_id_of(chat_id), parse_answers(answers)));
  handle("questions:dismiss", (chat_id, ids) => dismiss_questions(chat_id_of(chat_id), parse_ids(ids)));
};

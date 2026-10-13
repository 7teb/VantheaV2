import { set_open_questions } from "./store.ts";

export type OpenQuestion = {
  message_id: string;
  chat_id: string;
  asker_id: string;
  asker_name: string;
  to_id: string;
  to_name: string;
  about: string;
  summary: string;
  at: number;
};

const open = new Map<string, OpenQuestion>();

export const questions_asked_by = (agent_id: string): OpenQuestion[] => [...open.values()].filter((entry) => entry.asker_id === agent_id);

export const questions_asked_to = (agent_id: string): OpenQuestion[] => [...open.values()].filter((entry) => entry.to_id === agent_id);

export const sync_open_questions = (asker_id: string): void => {
  set_open_questions(asker_id, questions_asked_by(asker_id).length);
};

export const ask_question = (question: OpenQuestion): void => {
  open.set(question.message_id, question);
  sync_open_questions(question.asker_id);
};

const close = (question: OpenQuestion): OpenQuestion => {
  open.delete(question.message_id);
  sync_open_questions(question.asker_id);
  return question;
};

export const answer_question = (message_id: string, asker_id: string, answerer_id: string): OpenQuestion | null => {
  const question = open.get(message_id);
  if (!question || question.asker_id !== asker_id || question.to_id !== answerer_id) {
    return null;
  }
  return close(question);
};

export const close_question = (message_id: string): OpenQuestion | null => {
  const question = open.get(message_id);
  return question ? close(question) : null;
};

export const close_questions_to = (agent_id: string, unread: ReadonlySet<string> = new Set()): OpenQuestion[] =>
  questions_asked_to(agent_id)
    .filter((question) => !unread.has(question.message_id))
    .map(close);

export const forget_chat_questions = (chat_id: string): void => {
  for (const question of [...open.values()]) {
    if (question.chat_id === chat_id) {
      open.delete(question.message_id);
    }
  }
};

import { human_origin, type Message } from "./chat.ts";

export type AskQuestion = { title: string; options: string[] };

export type QuestionState = "sending" | "answered" | "dismissed";

export type QuestionStates = Record<string, QuestionState>;

export type QuestionAnswer = { id: string; answer: string };

export type OpenQuestion = AskQuestion & { id: string; message_id: string; call_id: string; index: number };

export const question_id = (message_id: string, call_id: string, index: number): string => `${message_id}:${call_id}:${index}`;

const closes_questions = (message: Message): boolean => message.role === "user" && human_origin(message.origin);

export const open_questions = (messages: Message[], states: QuestionStates): OpenQuestion[] => {
  const open: OpenQuestion[] = [];
  for (const message of messages.slice(messages.findLastIndex(closes_questions) + 1)) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const step of message.steps) {
      if (step.kind !== "tool" || step.status !== "done" || step.view?.kind !== "questions") {
        continue;
      }
      step.view.questions.forEach((question, index) => {
        const id = question_id(message.id, step.call_id, index);
        if (!Object.hasOwn(states, id)) {
          open.push({ ...question, id, message_id: message.id, call_id: step.call_id, index });
        }
      });
    }
  }
  return open;
};

export const answer_text = (entries: { title: string; answer: string }[]): string =>
  entries
    .map((entry) => ({ title: entry.title, answer: entry.answer.trim() }))
    .filter((entry) => entry.answer)
    .map((entry) => `Answer to your question "${entry.title}":\n${entry.answer}`)
    .join("\n\n");

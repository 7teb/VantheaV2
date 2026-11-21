import type { QuestionAnswer, QuestionStates } from "../questions.ts";
import { emit, invoke } from "./channel.ts";

export const question_limits = { entries: 50, answer: 200_000 } as const;

export const questions_channels = {
  "questions:answer": invoke<[chat_id: string, answers: QuestionAnswer[]], void>(),
  "questions:dismiss": invoke<[chat_id: string, ids: string[]], void>(),
  "questions:changed": emit<{ chat_id: string; questions: QuestionStates }>(),
} as const;

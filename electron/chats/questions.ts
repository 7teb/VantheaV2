import type { QuestionState, QuestionStates } from "../../shared/questions.ts";
import { schedule_save } from "./persist.ts";
import { bodies, chat_events, metas } from "./state.ts";

export type QuestionPatch = Record<string, QuestionState | null>;

export const set_question_states = (chat_id: string, patch: QuestionPatch): void => {
  const body = bodies.get(chat_id);
  if (!body) {
    if (metas.has(chat_id)) {
      throw new Error(`chat ${chat_id} is not loaded, call get_chat before set_question_states`);
    }
    return;
  }
  const questions: QuestionStates = { ...body.questions };
  for (const [id, state] of Object.entries(patch)) {
    if (state === null) {
      delete questions[id];
    } else {
      questions[id] = state;
    }
  }
  bodies.set(chat_id, { ...body, questions });
  schedule_save(chat_id);
  chat_events().questions(chat_id, { ...questions });
};

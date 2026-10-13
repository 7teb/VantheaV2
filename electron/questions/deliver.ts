import type { QuestionAnswer } from "../../shared/questions.ts";
import { get_chat } from "../chats/store.ts";
import { get_settings } from "../settings/store.ts";
import { active_turn, steer_target } from "../turn/active.ts";
import { start_turn, steer_turn } from "../turn/run.ts";
import { answer_group, answer_request, begin_answer, drop_sending, mark_dismissed } from "./answers.ts";

export const answer_questions = async (chat_id: string, answers: QuestionAnswer[]): Promise<void> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  const group = answer_group(chat, answers);
  if (!group.answered.length) {
    mark_dismissed(chat_id, group.skipped);
    return;
  }
  if (!active_turn(chat_id)) {
    await start_turn(answer_request(chat, group.text, get_settings()), [], "user");
    return;
  }
  const turn = steer_target(chat_id);
  if (!turn) {
    throw new Error(`the turn in chat ${chat_id} is ending, send the answer again once it has ended`);
  }
  const steer_id = begin_answer(chat_id, turn.message_id, group);
  if (await steer_turn(chat_id, group.text, [], steer_id)) {
    return;
  }
  drop_sending(chat_id, steer_id);
  throw new Error(`the turn in chat ${chat_id} ended before it took the answer, send it again`);
};

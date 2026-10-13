import { randomUUID } from "node:crypto";
import type { AssistantMessage, Chat, SteerMessage } from "../../shared/chat.ts";
import type { SendRequest } from "../../shared/ipc/chats.ts";
import { answer_text, open_questions, type OpenQuestion, type QuestionAnswer, type QuestionState } from "../../shared/questions.ts";
import type { Settings } from "../../shared/settings.ts";
import { set_question_states, type QuestionPatch } from "../chats/questions.ts";
import { get_chat } from "../chats/store.ts";
import { take_steer_active } from "../turn/active.ts";

type PendingAnswer = { turn_id: string; ids: string[] };

type AnswerGroup = { answered: string[]; skipped: string[]; text: string };

const pending = new Map<string, Map<string, PendingAnswer>>();

const patch_of = (ids: string[], state: QuestionState | null): QuestionPatch => Object.fromEntries(ids.map((id) => [id, state]));

const open_group = (chat: Chat, ids: string[]): OpenQuestion[] => {
  const open = open_questions(chat.messages, chat.questions);
  const closed = ids.find((id) => !open.some((question) => question.id === id));
  if (closed !== undefined) {
    throw new Error(`question ${closed} is not open in chat ${chat.id}`);
  }
  return open.filter((question) => ids.includes(question.id));
};

const release = (chat_id: string, steer_ids: string[], state: QuestionState | null): void => {
  const entries = pending.get(chat_id);
  if (!entries) {
    return;
  }
  const ids = steer_ids.flatMap((steer_id) => entries.get(steer_id)?.ids ?? []);
  for (const steer_id of steer_ids) {
    entries.delete(steer_id);
  }
  if (!entries.size) {
    pending.delete(chat_id);
  }
  if (ids.length) {
    set_question_states(chat_id, patch_of(ids, state));
  }
};

export const drop_sending = (chat_id: string, steer_id: string): void => release(chat_id, [steer_id], null);

export const take_main_steer = (chat_id: string, steer_id: string): SteerMessage | null => {
  const steer = take_steer_active(chat_id, steer_id);
  if (steer) {
    release(chat_id, [steer.id], "answered");
  }
  return steer;
};

export const settle_answers = async (chat_id: string, turn_id: string): Promise<void> => {
  const untaken = [...(pending.get(chat_id) ?? [])].filter(([, entry]) => entry.turn_id === turn_id).map(([steer_id]) => steer_id);
  if (!untaken.length) {
    return;
  }
  if (!(await get_chat(chat_id))) {
    pending.delete(chat_id);
    return;
  }
  release(chat_id, untaken, null);
};

export const forget_answers = (chat_id: string): void => {
  pending.delete(chat_id);
};

export const answer_group = (chat: Chat, answers: QuestionAnswer[]): AnswerGroup => {
  const given = new Map(answers.map((entry) => [entry.id, entry.answer.trim()]));
  const group = open_group(chat, [...given.keys()]).map((question) => ({ id: question.id, title: question.title, answer: given.get(question.id) ?? "" }));
  return {
    answered: group.filter((entry) => entry.answer).map((entry) => entry.id),
    skipped: group.filter((entry) => !entry.answer).map((entry) => entry.id),
    text: answer_text(group),
  };
};

export const mark_dismissed = (chat_id: string, ids: string[]): void => set_question_states(chat_id, patch_of(ids, "dismissed"));

export const begin_answer = (chat_id: string, turn_id: string, group: AnswerGroup): string => {
  const steer_id = randomUUID();
  const entries = pending.get(chat_id) ?? new Map<string, PendingAnswer>();
  entries.set(steer_id, { turn_id, ids: group.answered });
  pending.set(chat_id, entries);
  set_question_states(chat_id, { ...patch_of(group.answered, "sending"), ...patch_of(group.skipped, "dismissed") });
  return steer_id;
};

export const dismiss_questions = async (chat_id: string, ids: string[]): Promise<void> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    throw new Error(`chat ${chat_id} not found`);
  }
  mark_dismissed(chat_id, open_group(chat, ids).map((question) => question.id));
};

export const answer_request = (chat: Chat, text: string, settings: Settings): SendRequest => ({
  chat_id: chat.id,
  text,
  attachment_ids: [],
  model: settings.model,
  effort: settings.effort,
  mode: settings.mode,
  plan: chat.messages.findLast((message): message is AssistantMessage => message.role === "assistant")?.plan ?? false,
  origin: "user",
});

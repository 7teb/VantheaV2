import type { OpenQuestion } from "../../shared/questions.ts";
import { api } from "../api/bridge.ts";
import { failure, type ActionResult } from "./chat-actions.ts";
import { create_store } from "./create-store.ts";
import { after_send, empty_draft, submission, with_answer, with_text, type QuestionDraft } from "./question-drafts.ts";

export const question_drafts_store = create_store<Record<string, QuestionDraft>>({});

const draft_of = (chat_id: string): QuestionDraft => question_drafts_store.get()[chat_id] ?? empty_draft;

const put_draft = (chat_id: string, draft: QuestionDraft) => question_drafts_store.update((drafts) => ({ ...drafts, [chat_id]: draft }));

const drop_draft = (chat_id: string) =>
  question_drafts_store.update((drafts) => {
    const next = { ...drafts };
    delete next[chat_id];
    return next;
  });

export const show_question = (chat_id: string, id: string): void => put_draft(chat_id, { ...draft_of(chat_id), current: id });

export const record_answer = (chat_id: string, open: OpenQuestion[], id: string, answer: string): void =>
  put_draft(chat_id, with_answer(open, draft_of(chat_id), id, answer));

export const record_text = (chat_id: string, id: string, text: string): void => put_draft(chat_id, with_text(draft_of(chat_id), id, text));

export const submit_answers = async (chat_id: string, open: OpenQuestion[], id: string, answer: string): Promise<ActionResult> => {
  record_answer(chat_id, open, id, answer);
  const answers = submission(open, draft_of(chat_id));
  try {
    await api.invoke("questions:answer", chat_id, answers);
    put_draft(chat_id, after_send(answers));
    return { ok: true };
  } catch (error) {
    console.error(`[questions] questions:answer failed for chat ${chat_id} questions ${answers.map((entry) => entry.id).join(", ")}`, error);
    return failure(error);
  }
};

export const dismiss_open = async (chat_id: string, open: OpenQuestion[]): Promise<ActionResult> => {
  const ids = open.map((question) => question.id);
  try {
    await api.invoke("questions:dismiss", chat_id, ids);
    drop_draft(chat_id);
    return { ok: true };
  } catch (error) {
    console.error(`[questions] questions:dismiss failed for chat ${chat_id} questions ${ids.join(", ")}`, error);
    return failure(error);
  }
};

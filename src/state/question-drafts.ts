import type { OpenQuestion, QuestionAnswer } from "../../shared/questions.ts";

export type QuestionDraft = { current: string | null; answers: Record<string, string>; texts: Record<string, string> };

export const empty_draft: QuestionDraft = { current: null, answers: {}, texts: {} };

const index_of = (open: OpenQuestion[], id: string | null): number => open.findIndex((question) => question.id === id);

const without = (entries: Record<string, string>, id: string): Record<string, string> => Object.fromEntries(Object.entries(entries).filter(([key]) => key !== id));

export const current_index = (open: OpenQuestion[], draft: QuestionDraft): number => Math.max(0, index_of(open, draft.current));

export const with_answer = (open: OpenQuestion[], draft: QuestionDraft, id: string, answer: string): QuestionDraft => ({
  current: open[index_of(open, id) + 1]?.id ?? id,
  answers: { ...draft.answers, [id]: answer },
  texts: without(draft.texts, id),
});

export const with_text = (draft: QuestionDraft, id: string, text: string): QuestionDraft => ({
  ...draft,
  texts: text ? { ...draft.texts, [id]: text } : without(draft.texts, id),
});

export const shown_answer = (draft: QuestionDraft, id: string): string | undefined => draft.texts[id] ?? draft.answers[id];

export const submission = (open: OpenQuestion[], draft: QuestionDraft): QuestionAnswer[] =>
  open.map((question) => ({ id: question.id, answer: draft.answers[question.id] ?? "" }));

export const after_send = (sent: QuestionAnswer[]): QuestionDraft => ({
  current: null,
  answers: Object.fromEntries(sent.filter((entry) => entry.answer.trim()).map((entry) => [entry.id, entry.answer])),
  texts: {},
});

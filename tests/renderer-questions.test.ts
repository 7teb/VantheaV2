import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chat } from "../shared/chat.ts";
import type { OpenQuestion } from "../shared/questions.ts";
import { begin_load, empty_chat_view, finish_load, set_questions } from "../src/state/chat-view-reduce.ts";
import { after_send, current_index, empty_draft, shown_answer, submission, with_answer, with_text, type QuestionDraft } from "../src/state/question-drafts.ts";

const open_question = (index: number, options: string[] = ["yes", "no"]): OpenQuestion => ({
  id: `a1:c0_0:${index}`,
  message_id: "a1",
  call_id: "c0_0",
  index,
  title: `Question ${index}?`,
  options,
});

const group = [open_question(0), open_question(1, []), open_question(2)];

const chat = (id: string): Chat => ({
  id,
  title: "t",
  project_path: "D:\\p",
  workspace: "",
  pinned: false,
  created_at: "2026-10-10T10:00:00.000Z",
  updated_at: "2026-10-10T10:00:00.000Z",
  message_count: 0,
  streaming: false,
  summary: null,
  messages: [],
  questions: {},
});

test("the current question follows the draft id and falls back to the first open question", () => {
  assert.equal(current_index(group, empty_draft), 0);
  assert.equal(current_index(group, { ...empty_draft, current: "a1:c0_0:2" }), 2);
  assert.equal(current_index(group, { ...empty_draft, current: "gone:c0_0:0" }), 0);
  assert.equal(current_index(group.slice(0, 1), { ...empty_draft, current: "a1:c0_0:2" }), 0);
});

test("an answer is stored under its id and moves on to the next question, the last one stays current", () => {
  const first = with_answer(group, empty_draft, "a1:c0_0:0", "yes");
  assert.deepEqual(first, { current: "a1:c0_0:1", answers: { "a1:c0_0:0": "yes" }, texts: {} });
  const skipped = with_answer(group, first, "a1:c0_0:1", "");
  assert.deepEqual(skipped, { current: "a1:c0_0:2", answers: { "a1:c0_0:0": "yes", "a1:c0_0:1": "" }, texts: {} });
  const last = with_answer(group, skipped, "a1:c0_0:2", "no");
  assert.equal(last.current, "a1:c0_0:2");
  const changed = with_answer(group, last, "a1:c0_0:0", "no");
  assert.equal(changed.answers["a1:c0_0:0"], "no");
  assert.equal(changed.current, "a1:c0_0:1");
  assert.deepEqual(first.answers, { "a1:c0_0:0": "yes" });
});

test("typed but unconfirmed text survives moving between questions and gives way to a confirmed answer", () => {
  const typed = with_text(empty_draft, "a1:c0_0:1", "port 8080");
  assert.deepEqual(typed, { current: null, answers: {}, texts: { "a1:c0_0:1": "port 8080" } });
  const moved = { ...typed, current: "a1:c0_0:2" };
  assert.equal(shown_answer(moved, "a1:c0_0:1"), "port 8080");
  assert.deepEqual(submission(group, moved), [
    { id: "a1:c0_0:0", answer: "" },
    { id: "a1:c0_0:1", answer: "" },
    { id: "a1:c0_0:2", answer: "" },
  ]);
  const confirmed = with_answer(group, moved, "a1:c0_0:1", "port 9090");
  assert.deepEqual(confirmed.texts, {});
  assert.equal(shown_answer(confirmed, "a1:c0_0:1"), "port 9090");
  const edited = with_text(confirmed, "a1:c0_0:1", "port 7070");
  assert.equal(shown_answer(edited, "a1:c0_0:1"), "port 7070");
  assert.equal(shown_answer(with_text(edited, "a1:c0_0:1", ""), "a1:c0_0:1"), "port 9090");
  assert.equal(shown_answer(empty_draft, "a1:c0_0:1"), undefined);
});

test("a submission covers every open question in order and sends skipped and unvisited ones empty", () => {
  const draft: QuestionDraft = { current: "a1:c0_0:2", answers: { "a1:c0_0:2": "no", "old:c0_0:0": "stale" }, texts: { "a1:c0_0:0": "draft" } };
  assert.deepEqual(submission(group, draft), [
    { id: "a1:c0_0:0", answer: "" },
    { id: "a1:c0_0:1", answer: "" },
    { id: "a1:c0_0:2", answer: "no" },
  ]);
  assert.deepEqual(submission([], draft), []);
});

test("after a send only the given answers stay, so a reopened question shows them again from the first one", () => {
  const sent = [
    { id: "a1:c0_0:0", answer: "yes" },
    { id: "a1:c0_0:1", answer: "  " },
    { id: "a1:c0_0:2", answer: "" },
  ];
  assert.deepEqual(after_send(sent), { current: null, answers: { "a1:c0_0:0": "yes" }, texts: {} });
  assert.equal(current_index(group, after_send(sent)), 0);
});

test("question states replace the map of a ready chat and of a loading chat that already has one", () => {
  const ready = finish_load(begin_load(empty_chat_view, "c1"), "c1", chat("c1"));
  const updated = set_questions(ready, "c1", { "a1:c0_0:0": "sending" });
  assert.deepEqual(updated.entries.c1?.chat?.questions, { "a1:c0_0:0": "sending" });
  assert.equal(updated.entries.c1?.status, "ready");
  assert.equal(updated.entries.c1?.chat?.messages, ready.entries.c1?.chat?.messages);
  const reloading = begin_load(updated, "c1");
  const changed = set_questions(reloading, "c1", { "a1:c0_0:0": "answered" });
  assert.equal(changed.entries.c1?.status, "loading");
  assert.deepEqual(changed.entries.c1?.chat?.questions, { "a1:c0_0:0": "answered" });
});

test("question states for an unknown chat or a first load without a chat change nothing", () => {
  const loading = begin_load(empty_chat_view, "c1");
  assert.equal(set_questions(loading, "c1", { "a1:c0_0:0": "dismissed" }), loading);
  assert.equal(set_questions(loading, "c2", { "a1:c0_0:0": "dismissed" }), loading);
  const failed = finish_load(loading, "c1", null);
  assert.equal(set_questions(failed, "c1", { "a1:c0_0:0": "dismissed" }), failed);
});

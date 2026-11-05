import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { AssistantMessage, ToolStep } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { open_questions, type AskQuestion } from "../shared/questions.ts";
import type { Settings } from "../shared/settings.ts";
import { append_message, create_chat, flush_all_sync, flush_chat, get_chat } from "../electron/chats/store.ts";
import { answer_group, answer_request, begin_answer, dismiss_questions, drop_sending, forget_answers, mark_dismissed, settle_answers, take_main_steer } from "../electron/questions/answers.ts";
import { active_turn, push_steer, register_active, steer_target, unregister_active } from "../electron/turn/active.ts";
import { assistant_message, boot_chats, make_root, read_disk_chat, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1000000, max_output: 4096, reasoning_passback: false };

const runner: AskQuestion = { title: "Which runner?", options: ["node --test", "vitest"] };

const port: AskQuestion = { title: "Which port?", options: [] };

const asked = (id: string, plan = false): AssistantMessage => {
  const step: ToolStep = {
    id: "tool:0:c0_0",
    round: 0,
    kind: "tool",
    index: 0,
    call_id: "c0_0",
    name: "ask_user",
    args: { questions: [runner, port] },
    status: "done",
    progress: null,
    approval: null,
    view: { kind: "questions", questions: [runner, port] },
    error: null,
    result_text: "shown",
    started_at: 1,
    ended_at: 2,
  };
  return { ...assistant_message(id, ""), plan, steps: [step] };
};

const first = "a1:c0_0:0";

const second = "a1:c0_0:1";

const fresh = async (plan = false) => {
  const root = await make_root("vx-questions-");
  roots.push(root);
  const env = await boot_chats(root);
  const meta = await create_chat("");
  await append_message(meta.id, user_message("u1", "go"));
  await append_message(meta.id, asked("a1", plan));
  return { root, env, chat_id: meta.id };
};

const states = async (chat_id: string) => (await get_chat(chat_id))?.questions;

const loaded = async (chat_id: string) => {
  const chat = await get_chat(chat_id);
  assert.ok(chat);
  return chat;
};

const finish = (chat_id: string, turn_id: string) => {
  unregister_active(chat_id, turn_id);
  forget_answers(chat_id);
};

test("grouping an answer reads the open questions in order and writes no state", async () => {
  const { env, chat_id } = await fresh();
  const group = answer_group(await loaded(chat_id), [
    { id: second, answer: "" },
    { id: first, answer: " node --test " },
  ]);
  assert.deepEqual(group, { answered: [first], skipped: [second], text: 'Answer to your question "Which runner?":\nnode --test' });
  assert.deepEqual(await states(chat_id), {});
  assert.equal(env.questions.length, 0);
});

test("an answer marks the answered ids sending and the skipped ids dismissed before the steer is pushed", async () => {
  const { env, chat_id } = await fresh();
  register_active(chat_id, "a2", () => undefined, model, "high");
  const group = answer_group(await loaded(chat_id), [
    { id: second, answer: "" },
    { id: first, answer: " node --test " },
  ]);
  const steer_id = begin_answer(chat_id, "a2", group);
  assert.deepEqual(await states(chat_id), { [first]: "sending", [second]: "dismissed" });
  assert.deepEqual(env.questions.at(-1), { chat_id, questions: { [first]: "sending", [second]: "dismissed" } });
  assert.equal(push_steer(chat_id, group.text, steer_id), true);
  assert.deepEqual(open_questions((await loaded(chat_id)).messages, (await loaded(chat_id)).questions), []);
  finish(chat_id, "a2");
});

test("taking the steers at a round start marks the answered ids answered and returns the steer", async () => {
  const { root, chat_id } = await fresh();
  register_active(chat_id, "a2", () => undefined, model, "high");
  const group = answer_group(await loaded(chat_id), [
    { id: first, answer: "vitest" },
    { id: second, answer: "" },
  ]);
  const steer_id = begin_answer(chat_id, "a2", group);
  push_steer(chat_id, group.text, steer_id);
  await flush_chat(chat_id);
  assert.deepEqual((await read_disk_chat(root, chat_id)).questions, { [second]: "dismissed" });
  const taken = take_main_steer(chat_id, steer_id);
  assert.deepEqual([taken?.id, taken?.text], [steer_id, 'Answer to your question "Which runner?":\nvitest']);
  assert.deepEqual(await states(chat_id), { [first]: "answered", [second]: "dismissed" });
  await flush_chat(chat_id);
  assert.deepEqual((await read_disk_chat(root, chat_id)).questions, { [first]: "answered", [second]: "dismissed" });
  assert.equal(take_main_steer(chat_id, steer_id), null);
  finish(chat_id, "a2");
});

test("taking one answer steer marks only its answers answered and settling releases the untaken one", async () => {
  const { chat_id } = await fresh();
  register_active(chat_id, "a2", () => undefined, model, "high");
  const taken_id = begin_answer(chat_id, "a2", answer_group(await loaded(chat_id), [{ id: first, answer: "vitest" }]));
  push_steer(chat_id, "runner answer", taken_id);
  const left_id = begin_answer(chat_id, "a2", answer_group(await loaded(chat_id), [{ id: second, answer: "3000" }]));
  push_steer(chat_id, "port answer", left_id);
  assert.equal(take_main_steer(chat_id, taken_id)?.text, "runner answer");
  assert.deepEqual(await states(chat_id), { [first]: "answered", [second]: "sending" });
  assert.deepEqual(active_turn(chat_id)?.steers.map((steer) => steer.id), [left_id]);
  unregister_active(chat_id, "a2");
  await settle_answers(chat_id, "a2");
  assert.deepEqual(await states(chat_id), { [first]: "answered" });
  forget_answers(chat_id);
});

test("settling a finished turn reopens an untaken answer and keeps the dismissals", async () => {
  const { chat_id } = await fresh();
  register_active(chat_id, "a2", () => undefined, model, "high");
  const group = answer_group(await loaded(chat_id), [
    { id: first, answer: "vitest" },
    { id: second, answer: "" },
  ]);
  push_steer(chat_id, group.text, begin_answer(chat_id, "a2", group));
  unregister_active(chat_id, "a2");
  await settle_answers(chat_id, "other-turn");
  assert.deepEqual(await states(chat_id), { [first]: "sending", [second]: "dismissed" });
  await settle_answers(chat_id, "a2");
  assert.deepEqual(await states(chat_id), { [second]: "dismissed" });
  const chat = await loaded(chat_id);
  assert.deepEqual(
    open_questions(chat.messages, chat.questions).map((question) => question.id),
    [first],
  );
  forget_answers(chat_id);
});

test("dropping a steer that did not reach a turn reopens its answers", async () => {
  const { chat_id } = await fresh();
  const steer_id = begin_answer(chat_id, "a2", answer_group(await loaded(chat_id), [{ id: first, answer: "vitest" }]));
  assert.equal(active_turn(chat_id), null);
  assert.deepEqual(await states(chat_id), { [first]: "sending" });
  drop_sending(chat_id, steer_id);
  assert.deepEqual(await states(chat_id), {});
  drop_sending(chat_id, steer_id);
  assert.deepEqual(await states(chat_id), {});
});

test("a submission without any answer has nothing answered and dismisses its questions without a steer", async () => {
  const { chat_id } = await fresh();
  const turn = register_active(chat_id, "a2", () => undefined, model, "high");
  const group = answer_group(await loaded(chat_id), [
    { id: first, answer: "  " },
    { id: second, answer: "" },
  ]);
  assert.deepEqual(group.answered, []);
  mark_dismissed(chat_id, group.skipped);
  assert.deepEqual(turn.steers, []);
  assert.deepEqual(await states(chat_id), { [first]: "dismissed", [second]: "dismissed" });
  finish(chat_id, "a2");
});

test("a turn that ended or was stopped is no steer target and takes no steer", async () => {
  const { chat_id } = await fresh();
  const stopped = register_active(chat_id, "a2", () => undefined, model, "high");
  assert.equal(steer_target(chat_id), stopped);
  stopped.controller.abort(new Error("the user stopped the turn"));
  assert.equal(active_turn(chat_id), stopped);
  assert.equal(steer_target(chat_id), null);
  assert.equal(push_steer(chat_id, "late", "s1"), false);
  unregister_active(chat_id, "a2");
  const ended = register_active(chat_id, "a3", () => undefined, model, "high");
  ended.emit({ type: "end", status: "done", error: null });
  assert.equal(active_turn(chat_id), ended);
  assert.equal(steer_target(chat_id), null);
  assert.deepEqual(ended.steers, []);
  finish(chat_id, "a3");
});

test("an unknown or closed question id throws and changes nothing", async () => {
  const { chat_id } = await fresh();
  const turn = register_active(chat_id, "a2", () => undefined, model, "high");
  const chat = await loaded(chat_id);
  assert.throws(() => answer_group(chat, [{ id: "a1:c0_0:7", answer: "x" }, { id: first, answer: "y" }]), new RegExp(`question a1:c0_0:7 is not open in chat ${chat_id}`));
  assert.deepEqual(await states(chat_id), {});
  await dismiss_questions(chat_id, [second]);
  assert.deepEqual(await states(chat_id), { [second]: "dismissed" });
  const reloaded = await loaded(chat_id);
  assert.throws(() => answer_group(reloaded, [{ id: second, answer: "z" }]), new RegExp(`question ${second} is not open in chat ${chat_id}`));
  await assert.rejects(() => dismiss_questions(chat_id, [second]), /is not open/);
  assert.deepEqual(await states(chat_id), { [second]: "dismissed" });
  assert.deepEqual(turn.steers, []);
  finish(chat_id, "a2");
});

test("an answer with no running turn becomes a user request that keeps plan mode", async () => {
  const { chat_id } = await fresh(true);
  const settings = { model: "x/model", effort: "low", mode: "ask" } as Settings;
  const request = answer_request(await loaded(chat_id), 'Answer to your question "Which runner?":\nvitest', settings);
  assert.deepEqual(request, {
    chat_id,
    text: 'Answer to your question "Which runner?":\nvitest',
    attachment_ids: [],
    model: "x/model",
    effort: "low",
    pro: false,
    mode: "ask",
    plan: true,
    origin: "user",
  });
  const plain = await fresh(false);
  assert.equal(answer_request(await loaded(plain.chat_id), "t", settings).plan, false);
  const chosen = { ...(await loaded(plain.chat_id)), choice: { model: "openai/gpt-6.1-sol", effort: "xhigh", pro: true } };
  const answered = answer_request(chosen, "t", settings);
  assert.deepEqual([answered.model, answered.effort, answered.pro], ["openai/gpt-6.1-sol", "xhigh", true]);
});

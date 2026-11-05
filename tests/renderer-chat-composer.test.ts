import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment } from "../shared/chat.ts";
import {
  acknowledge_steer,
  dequeue,
  fail_steering,
  draft_key,
  draft_of,
  draft_sendable,
  empty_composer,
  enqueue,
  move_draft,
  patch_draft,
  put_upload,
  queue_of,
  queued_to_draft,
  remove_queued,
  remove_upload,
  release_steers,
  restore_draft,
  set_steering,
  take_draft,
  type QueuedMessage,
} from "../src/state/chat-drafts.ts";

const attachment: Attachment = { id: "img_a_b.png", kind: "image", name: "shot.png", mime: "image/png", size: 10, vision_note: null };

const queued = (id: string, text = id): QueuedMessage => ({ id, text, attachments: [], plan: false, steering: false });

test("drafts are kept per chat and per project for new chats", () => {
  let state = patch_draft(empty_composer, "c1", { text: "first" });
  state = patch_draft(state, draft_key(null, "D:\\p"), { text: "hero" });
  assert.equal(draft_of(state, "c1").text, "first");
  assert.equal(draft_of(state, "c2").text, "");
  assert.equal(draft_of(state, "new:D:\\p").text, "hero");
  assert.equal(draft_of(state, "new:D:\\q").text, "");
});

test("a draft is sendable with text or a ready attachment, never while uploading", () => {
  const key = "c1";
  let state = patch_draft(empty_composer, key, { text: "  " });
  assert.equal(draft_sendable(draft_of(state, key)), false);
  state = put_upload(state, key, { key: "u1", name: "shot.png", size: 10, image: true, status: "uploading", attachment: null, preview: "blob:shot" });
  assert.equal(draft_sendable(draft_of(state, key)), false);
  state = put_upload(state, key, { key: "u1", name: "shot.png", size: 10, image: true, status: "ready", attachment, preview: "blob:shot" });
  assert.equal(draft_sendable(draft_of(state, key)), true);
  assert.equal(draft_of(state, key).uploads.length, 1);
  state = remove_upload(state, key, "u1");
  assert.equal(draft_sendable(draft_of(state, key)), false);
});

test("taking a draft clears text and uploads but keeps the plan toggle", () => {
  let state = patch_draft(empty_composer, "c1", { text: " do it ", plan: true });
  state = put_upload(state, "c1", { key: "u1", name: "shot.png", size: 10, image: true, status: "ready", attachment, preview: "blob:shot" });
  state = put_upload(state, "c1", { key: "u2", name: "log.txt", size: 90, image: false, status: "uploading", attachment: null, preview: null });
  const taken = take_draft(state, "c1");
  assert.deepEqual(taken.message, { text: "do it", attachments: [attachment], plan: true });
  assert.deepEqual(draft_of(taken.state, "c1"), { text: "", uploads: [], plan: true, chips: [] });
});

test("restoring a failed send puts text and attachments back in front of new typing", () => {
  let state = patch_draft(empty_composer, "c1", { text: "typed later" });
  state = restore_draft(state, "c1", { text: "original", attachments: [attachment], plan: false });
  const draft = draft_of(state, "c1");
  assert.equal(draft.text, "original\ntyped later");
  assert.equal(draft.uploads[0].attachment, attachment);
  assert.equal(draft.uploads[0].preview, null);
  assert.equal(draft.uploads[0].status, "ready");
});

test("a hero draft moves to the chat it created", () => {
  let state = patch_draft(empty_composer, "new:D:\\p", { plan: true });
  state = move_draft(state, "new:D:\\p", "c9");
  assert.equal(draft_of(state, "c9").plan, true);
  assert.equal(state.drafts["new:D:\\p"], undefined);
});

test("the queue is per chat and sends in order", () => {
  let state = enqueue(empty_composer, "c1", queued("q1"));
  state = enqueue(state, "c1", queued("q2"));
  state = enqueue(state, "c2", queued("other"));
  const first = dequeue(state, "c1");
  assert.equal(first.next?.id, "q1");
  const second = dequeue(first.state, "c1");
  assert.equal(second.next?.id, "q2");
  const empty = dequeue(second.state, "c1");
  assert.equal(empty.next, null);
  assert.equal(empty.state.queues.c1, undefined);
  assert.equal(queue_of(empty.state, "c2").length, 1);
});

test("an entry that is being steered is skipped by dequeue and can be removed", () => {
  let state = enqueue(empty_composer, "c1", queued("q1"));
  state = enqueue(state, "c1", queued("q2"));
  state = set_steering(state, "c1", "q1", true);
  const taken = dequeue(state, "c1");
  assert.equal(taken.next?.id, "q2");
  assert.deepEqual(
    queue_of(taken.state, "c1").map((entry) => entry.id),
    ["q1"],
  );
  const steered = remove_queued(taken.state, "c1", "q1");
  assert.equal(queue_of(steered, "c1").length, 0);
  assert.equal(queue_of(steered, "c1"), queue_of(empty_composer, "c1"));
});

test("a steer card is kept until its delivery ID is acknowledged, even with duplicate text", () => {
  let state = enqueue(empty_composer, "c1", queued("q1", "same"));
  state = enqueue(state, "c1", queued("q2", "same"));
  state = set_steering(state, "c1", "q1", true, "s1", "m1");
  state = set_steering(state, "c1", "q2", true, "s2", "m1");
  assert.equal(queue_of(state, "c1").length, 2);
  state = acknowledge_steer(state, "c1", "s1");
  assert.deepEqual(queue_of(state, "c1").map((entry) => entry.id), ["q2"]);
  assert.equal(acknowledge_steer(state, "c1", "s1"), state);
  state = acknowledge_steer(state, "c1", "s2");
  assert.equal(queue_of(state, "c1").length, 0);
});

test("turn end restores its own pending cards and a new attempt ignores an old acknowledgment", () => {
  let state = enqueue(empty_composer, "c1", queued("q1"));
  state = enqueue(state, "c1", queued("q2"));
  state = set_steering(state, "c1", "q1", true, "old-s1", "m1");
  state = set_steering(state, "c1", "q2", true, "s2", "m2");
  state = release_steers(state, "c1", "m1");
  assert.equal(queue_of(state, "c1")[0]?.steer_failed, true);
  assert.equal(queue_of(state, "c1")[1]?.steering, true);
  assert.equal(dequeue(state, "c1").next, null);
  state = set_steering(state, "c1", "q1", true, "new-s1", "m2");
  assert.equal(queue_of(state, "c1")[0]?.steer_failed, false);
  assert.equal(acknowledge_steer(state, "c1", "old-s1"), state);
  assert.equal(release_steers(state, "c1", "m1"), state);
  state = fail_steering(state, "c1", "q1");
  assert.equal(queue_of(state, "c1")[0]?.steering, false);
  assert.equal(queue_of(state, "c1")[0]?.text, "q1");
});

test("editing a queued message moves its text and attachments in front of the draft and drops only that entry", () => {
  let state = patch_draft(empty_composer, "c1", { text: "typed later" });
  state = enqueue(state, "c1", { ...queued("q1", "first"), attachments: [attachment] });
  state = enqueue(state, "c1", queued("q2"));
  state = queued_to_draft(state, "c1", "q1");
  const draft = draft_of(state, "c1");
  assert.equal(draft.text, "first\ntyped later");
  assert.equal(draft.uploads.length, 1);
  assert.equal(draft.uploads[0].attachment, attachment);
  assert.equal(draft.uploads[0].status, "ready");
  assert.equal(draft.plan, false);
  assert.deepEqual(queue_of(state, "c1").map((entry) => entry.id), ["q2"]);
});

test("editing keeps the plan flag of a queued plan message and empties the queue entry", () => {
  let state = enqueue(empty_composer, "c1", { ...queued("q1", "change step two"), plan: true });
  state = queued_to_draft(state, "c1", "q1");
  assert.deepEqual(draft_of(state, "c1"), { text: "change step two", uploads: [], plan: true, chips: [] });
  assert.equal(state.queues.c1, undefined);
});

test("a message that is being steered or no longer queued cannot be edited", () => {
  let state = enqueue(empty_composer, "c1", queued("q1"));
  state = set_steering(state, "c1", "q1", true, "s1", "m1");
  assert.equal(queued_to_draft(state, "c1", "q1"), state);
  assert.equal(queued_to_draft(state, "c1", "missing"), state);
  state = fail_steering(state, "c1", "q1");
  state = queued_to_draft(state, "c1", "q1");
  assert.equal(draft_of(state, "c1").text, "q1");
  assert.equal(queue_of(state, "c1").length, 0);
});

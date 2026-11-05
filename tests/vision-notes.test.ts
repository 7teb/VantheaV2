import assert from "node:assert/strict";
import { test } from "node:test";
import type { Attachment, Message } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { note_images, note_newest_user, type Describer } from "../electron/turn/vision-notes.ts";

const model = (vision: boolean): ModelEntry => ({
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
});

const image = (n: number, model_id?: string): Attachment => ({
  id: `img_a${n}_00000000.png`,
  kind: "image",
  name: `${n}.png`,
  mime: "image/png",
  size: 1,
  vision_note: null,
  ...(model_id ? { model: { id: model_id, width: 1, height: 1 } } : {}),
});

const file: Attachment = { id: "att_a9_00000000.txt", kind: "file", name: "f.txt", mime: "text/plain", size: 1, vision_note: null };

const aborted = (signal: AbortSignal): Promise<string> =>
  new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

test("notes for one message run in parallel and describe the model copy when there is one", async () => {
  const started: string[] = [];
  const releases: (() => void)[] = [];
  const describe: Describer = (id) => {
    started.push(id);
    return new Promise((resolve) => releases.push(() => resolve(`note of ${id}`)));
  };
  const pending = note_images([image(1, "img_c1_00000000.jpg"), file, image(2)], model(false), new AbortController().signal, describe);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["img_c1_00000000.jpg", "img_a2_00000000.png"]);
  for (const release of releases) {
    release();
  }
  const noted = await pending;
  assert.deepEqual(noted.map((entry) => entry.vision_note), ["note of img_c1_00000000.jpg", null, "note of img_a2_00000000.png"]);
});

test("a failing call leaves that attachment without a note and the promise still resolves", async () => {
  const describe: Describer = async (id) => {
    if (id.startsWith("img_a1")) {
      throw new Error("side model down");
    }
    return "fine";
  };
  const noted = await note_images([image(1), image(2)], model(false), new AbortController().signal, describe);
  assert.deepEqual(noted.map((entry) => entry.vision_note), [null, "fine"]);
});

test("an abort resolves with the notes that are done", async () => {
  const controller = new AbortController();
  const describe: Describer = (id, signal) => (id.startsWith("img_a1") ? Promise.resolve("quick") : aborted(signal));
  const pending = note_images([image(1), image(2)], model(false), controller.signal, describe);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("stop"));
  assert.deepEqual((await pending).map((entry) => entry.vision_note), ["quick", null]);
});

test("a vision model and an existing note need no call", async () => {
  let calls = 0;
  const describe: Describer = async () => {
    calls += 1;
    return "x";
  };
  const input = [image(1)];
  assert.equal(await note_images(input, model(true), new AbortController().signal, describe), input);
  const kept = await note_images([{ ...image(2), vision_note: "already" }], model(false), new AbortController().signal, describe);
  assert.equal(kept[0]?.vision_note, "already");
  assert.equal(calls, 0);
});

const user_message = (id: string, attachments: Attachment[]): Message => ({ id, role: "user", text: id, attachments, origin: "user", created_at: "2026-10-12T00:00:00.000Z" });

test("the newest user message gets its notes inside the turn and is saved once", async () => {
  const saved: Message[] = [];
  const older = user_message("u1", [image(1)]);
  const messages = [older, user_message("u2", [image(2), file])];
  const noted = await note_newest_user(messages, model(false), new AbortController().signal, async (id) => `note of ${id}`, (message) => saved.push(message));
  assert.equal(noted[0], older);
  const newest = noted[1];
  assert.ok(newest?.role === "user");
  assert.deepEqual(newest.attachments.map((entry) => entry.vision_note), ["note of img_a2_00000000.png", null]);
  assert.deepEqual(saved, [newest]);
});

test("a stop during the notes ends the turn instead of sending the message without them", async () => {
  const controller = new AbortController();
  const saved: Message[] = [];
  const pending = note_newest_user([user_message("u1", [image(1)])], model(false), controller.signal, (_id, signal) => aborted(signal), (message) => saved.push(message));
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error("the user stopped the turn"));
  await assert.rejects(pending, /the user stopped the turn/);
  assert.deepEqual(saved, []);
});

test("a vision model or a newest message without unnoted images leaves the history as it is", async () => {
  const describe: Describer = async () => assert.fail("no call expected");
  const save = () => assert.fail("no save expected");
  const with_image = [user_message("u1", [image(1)])];
  assert.equal(await note_newest_user(with_image, model(true), new AbortController().signal, describe, save), with_image);
  const plain = [user_message("u1", [file])];
  assert.equal(await note_newest_user(plain, model(false), new AbortController().signal, describe, save), plain);
});

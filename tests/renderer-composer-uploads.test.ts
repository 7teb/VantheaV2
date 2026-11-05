import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import { bundle, install_dom } from "./dom-kit.ts";

const project = "D:\\Projects\\demo";
const blank_key = "new:";
const project_key = `new:${project}`;
const calls: { name: string; args: unknown[] }[] = [];
const saves: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
let client: any;
let restore = () => {};

const invoke = (name: string, ...args: unknown[]): Promise<unknown> => {
  calls.push({ name, args });
  if (name === "attachments:save") {
    return new Promise((resolve, reject) => void saves.push({ resolve, reject }));
  }
  if (name === "chats:create") {
    return Promise.resolve({ id: "created-1", title: "", project_path: String(args[0]), workspace: "", pinned: false, created_at: "", updated_at: "", message_count: 0, streaming: false });
  }
  return Promise.resolve(undefined);
};

const attachment = (id: string) => ({ id, name: "notes.txt", size: 5, kind: "file", mime: "text/plain" });

const discarded = () => calls.filter((call) => call.name === "attachments:discard").map((call) => call.args[0]);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const start_upload = async (key: string) => {
  const pending = client.attach_files(key, [new File(["hello"], "notes.txt", { type: "text/plain" })]);
  await tick();
  assert.equal(saves.length, 1);
  return { pending };
};

const uploads = (key: string) => client.draft_of(client.composer_store.get(), key).uploads;

const reset = () => {
  calls.length = 0;
  saves.length = 0;
  client.composer_store.set(client.empty_composer);
};

before(async () => {
  const vx = { invoke, on: () => () => {}, send: () => {}, file_path: () => "" };
  restore = install_dom(vx).restore;
  client = await bundle(
    [
      'export { attach_files, carry_new_draft, composer_store, discard_upload } from "./src/state/composer.ts";',
      'export { start_command_turn } from "./src/state/chat-create.ts";',
      'export { draft_of, draft_sendable, empty_composer } from "./src/state/chat-drafts.ts";',
    ],
    [],
  );
});

after(() => restore());

test("an upload that finishes after its draft moved to the picked project lands ready in the moved draft", async () => {
  reset();
  const { pending } = await start_upload(blank_key);
  client.carry_new_draft(blank_key, project_key);
  assert.deepEqual(Object.keys(client.composer_store.get().drafts), [project_key]);
  saves[0].resolve(attachment("a1"));
  await pending;
  const moved = uploads(project_key);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].status, "ready");
  assert.equal(moved[0].attachment.id, "a1");
  assert.equal(client.draft_sendable(client.draft_of(client.composer_store.get(), project_key)), true);
  assert.deepEqual(uploads(blank_key), []);
  assert.deepEqual(discarded(), []);
});

test("an upload that finishes after Initialize moved the fresh draft into the created chat lands there", async () => {
  reset();
  const { pending } = await start_upload(project_key);
  await client.start_command_turn(null, project, "init");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["attachments:save", "chats:create", "turn:init"],
  );
  saves[0].resolve(attachment("a2"));
  await pending;
  const moved = uploads("created-1");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].status, "ready");
  assert.equal(moved[0].attachment.id, "a2");
  assert.deepEqual(uploads(project_key), []);
  assert.deepEqual(discarded(), []);
});

test("an upload that fails after its draft moved is removed from the moved draft and the error shows there", async (t: TestContext) => {
  reset();
  const logged = t.mock.method(console, "error", () => {});
  const { pending } = await start_upload(blank_key);
  client.carry_new_draft(blank_key, project_key);
  saves[0].reject(new Error("disk full"));
  await pending;
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^\[composer\] attachments:save failed for notes\.txt/);
  assert.deepEqual(uploads(project_key), []);
  assert.match(client.composer_store.get().errors[project_key], /disk full/);
  assert.equal(client.composer_store.get().errors[blank_key], undefined);
});

test("an upload the user removed while it was saving is discarded once the save finishes", async () => {
  reset();
  const { pending } = await start_upload(blank_key);
  client.carry_new_draft(blank_key, project_key);
  client.discard_upload(project_key, uploads(project_key)[0].key);
  saves[0].resolve(attachment("a3"));
  await pending;
  assert.deepEqual(uploads(project_key), []);
  assert.deepEqual(discarded(), [["a3"]]);
});

test("an upload whose draft never moved still becomes ready in place", async () => {
  reset();
  const { pending } = await start_upload(blank_key);
  saves[0].resolve(attachment("a4"));
  await pending;
  assert.equal(uploads(blank_key)[0].status, "ready");
  assert.deepEqual(discarded(), []);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AssistantMessage, Message, Step, ToolStatus, ToolStep, UserMessage } from "../shared/chat.ts";
import { file_changes, undoable_turn } from "../shared/file-changes.ts";
import type { ModelEntry } from "../shared/models.ts";
import { open_questions } from "../shared/questions.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { clear_authorization, human_requests_of, set_authorization } from "../electron/permissions/context.ts";
import { remove_retired_snapshots, set_storage_root, storage_dirs } from "../electron/storage/paths.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { undo_request_text } from "../electron/turn/undo-request.ts";
import { counted_image } from "../electron/turn/user-input.ts";

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1_000_000, max_output: 4096, reasoning_passback: false };

const user = (id: string, text: string, origin: UserMessage["origin"] = "user"): UserMessage => ({ id, role: "user", text, origin, attachments: [], created_at: "2026-10-14T10:00:00.000Z" });

const assistant = (id: string, steps: Step[], status: AssistantMessage["status"] = "done"): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "",
  mode: "auto",
  plan: false,
  created_at: "2026-10-14T10:00:01.000Z",
  ended_at: status === "streaming" ? null : "2026-10-14T10:00:05.000Z",
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

const edit = (call_id: string, file: string, created: boolean, added: number, removed: number, status: ToolStatus = "done"): ToolStep => ({
  id: call_id,
  round: 0,
  kind: "tool",
  index: 0,
  call_id,
  name: created ? "write_file" : "replace_in_file",
  args: {},
  status,
  progress: null,
  approval: null,
  view: { kind: "edit", path: file, created, added, removed, diff: [] },
  error: null,
  result_text: "",
  started_at: 1,
  ended_at: 2,
});

const text = (id: string, value: string): Step => ({ id, round: 0, kind: "text", text: value });

const manual_compaction = (id: string): AssistantMessage => assistant(id, [{ id: `${id}-c`, round: 0, kind: "compaction", status: "done", source: "manual" }]);

test("the undo request names every file of the turn and says which ones the turn created", () => {
  const steps = [edit("c1", "src/app.ts", false, 3, 1), edit("c2", "src/new.ts", true, 12, 0), edit("c3", "src/app.ts", false, 1, 1)];
  const request = undo_request_text(file_changes(steps));
  const lines = request.split("\n");
  assert.match(lines[0] ?? "", /^Undo the changes you made in your previous turn\./);
  assert.deepEqual(lines.slice(1, 3), ["- src/app.ts (edited)", "- src/new.ts (created in that turn)"]);
  assert.match(lines[3] ?? "", /delete the files that turn created/);
  assert.match(lines[3] ?? "", /say so instead of guessing/);
  assert.equal(lines.length, 4);
});

test("only the newest turn with file changes can be undone", () => {
  const older = assistant("a1", [edit("c1", "a.ts", false, 1, 1)]);
  const newest = assistant("a2", [text("t", "done"), edit("c2", "b.ts", true, 4, 0)]);
  assert.equal(undoable_turn([user("u1", "edit a"), older, user("u2", "add b"), newest])?.id, "a2");
  assert.equal(undoable_turn([user("u1", "edit a"), older, user("u2", "explain"), assistant("a3", [text("t", "it does x")])]), null);
  assert.equal(undoable_turn([user("u1", "edit a"), older, user("b", "task done", "background"), assistant("a4", [text("t", "noted")])]), null);
  assert.equal(undoable_turn([]), null);
});

test("a manual compaction after the turn keeps that turn undoable", () => {
  const turn = assistant("a1", [edit("c1", "a.ts", false, 1, 1)]);
  assert.equal(undoable_turn([user("u1", "edit a"), turn, manual_compaction("k1")])?.id, "a1");
});

test("failed or denied edits do not make a turn undoable", () => {
  const turn = assistant("a1", [edit("c1", "a.ts", false, 1, 1, "failed"), edit("c2", "b.ts", true, 2, 0, "denied")]);
  assert.equal(undoable_turn([user("u1", "edit"), turn]), null);
});

test("an undo request counts as a human message for the permission review", () => {
  const chat_id = "undo-context";
  const request = undo_request_text([{ path: "src/new.ts", added: 4, removed: 0, created: true }]);
  set_authorization(chat_id, [user("u1", "Create src/new.ts."), assistant("a1", [edit("c1", "src/new.ts", true, 4, 0)]), user("u2", request, "undo")]);
  assert.deepEqual(
    human_requests_of(chat_id).map((entry) => entry.text),
    ["Create src/new.ts.", request],
  );
  clear_authorization(chat_id);
});

test("an undo request closes the questions of earlier turns", () => {
  const asked: ToolStep = {
    ...edit("q1", "", false, 0, 0),
    name: "ask_questions",
    view: { kind: "questions", questions: [{ title: "Keep the old API?", options: ["yes", "no"] }] },
  };
  const before: Message[] = [user("u1", "refactor"), assistant("a1", [asked, edit("c1", "api.ts", false, 2, 2)])];
  assert.equal(open_questions(before, {}).length, 1);
  assert.equal(open_questions([...before, user("u2", "Undo the changes", "undo")], {}).length, 0);
});

test("an undo request is replayed to the model as the user's instruction", async () => {
  const messages: Message[] = [user("u1", "edit a"), assistant("a1", [edit("c1", "a.ts", false, 1, 1)]), user("u2", "Undo the changes you made in your previous turn.", "undo")];
  const out = await build_api_messages({ system: "", summary: null, messages, model, agent_tools: true }, counted_image);
  const last = out.at(-1) as ApiMessage;
  assert.equal(last.role, "user");
  assert.equal(last.role === "user" && last.instruction, true);
});

test("the retired undo snapshot folder is removed once and no longer created", async () => {
  const user_data = await fs.mkdtemp(path.join(os.tmpdir(), "vx-retired-snapshots-"));
  try {
    const paths = set_storage_root(user_data);
    assert.equal(storage_dirs(paths).includes(paths.retired_snapshots), false);
    await fs.mkdir(paths.retired_snapshots, { recursive: true });
    await fs.writeFile(path.join(paths.retired_snapshots, "turn-a.json"), "{}");
    assert.equal(await remove_retired_snapshots(paths), true);
    await assert.rejects(fs.stat(paths.retired_snapshots), { code: "ENOENT" });
    assert.equal(await remove_retired_snapshots(paths), false);
  } finally {
    await fs.rm(user_data, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

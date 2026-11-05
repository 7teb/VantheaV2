import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { add_authorization, clear_authorization, human_requests_of, note_human_answer, set_authorization } from "../electron/permissions/context.ts";
import { agent_edits, forget_instruction_files, instruction_snapshot, is_instruction_file, refresh_instruction_snapshot } from "../electron/permissions/instruction-files.ts";
import type { Message } from "../shared/chat.ts";

const roots: string[] = [];

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const project = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-instructions-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "AGENTS.md"), "Rules:\n- Never push.\n");
  return root;
};

const user = (id: string, at: number, origin: "user" | "plan_accept" = "user"): Message => ({
  id,
  role: "user",
  text: id,
  attachments: [],
  origin,
  created_at: new Date(Date.now() + at).toISOString(),
});

test("the snapshot is taken at the last human event and agent edits come as a diff", async () => {
  const root = await project();
  const chat = "instr-a";
  set_authorization(chat, [user("u1", 1)]);
  const first = await instruction_snapshot(chat, root, human_requests_of(chat));
  assert.equal(first.number, 1);
  assert.equal(first.files.find((file) => file.name === "AGENTS.md")?.text, "Rules:\n- Never push.\n");
  assert.equal(first.files.find((file) => file.name === "CLAUDE.md")?.text, null);
  assert.equal((await agent_edits(chat, root)).text, "");
  await fs.writeFile(path.join(root, "AGENTS.md"), "Rules:\n- Push freely.\n");
  await fs.writeFile(path.join(root, "CLAUDE.md"), "new\n");
  const edits = await agent_edits(chat, root);
  assert.deepEqual(edits.files, ["AGENTS.md", "CLAUDE.md"]);
  assert.match(edits.text, /^--- AGENTS\.md\n Rules:\n-- Never push\.\n\+- Push freely\./);
  assert.match(edits.text, /--- CLAUDE\.md \(created\)\n\+new/);
  assert.equal((await instruction_snapshot(chat, root, human_requests_of(chat))).files[0]?.text, "Rules:\n- Never push.\n");
  forget_instruction_files(chat);
  clear_authorization(chat);
});

test("a message, steer or plan acceptance moves the snapshot, an approval answer does not", async () => {
  const root = await project();
  const chat = "instr-b";
  set_authorization(chat, [user("u1", 1)]);
  await instruction_snapshot(chat, root, human_requests_of(chat));
  await fs.writeFile(path.join(root, "AGENTS.md"), "edited by the agent\n");
  note_human_answer(chat, "answer-1", Date.now() + 5);
  const after_answer = await instruction_snapshot(chat, root, human_requests_of(chat));
  assert.equal(after_answer.files[0]?.text, "Rules:\n- Never push.\n");
  add_authorization(chat, "steer-1", "go on", undefined, [], Date.now() + 10);
  const after_steer = await instruction_snapshot(chat, root, human_requests_of(chat));
  assert.equal(after_steer.anchor, "steer-1");
  assert.equal(after_steer.files[0]?.text, "edited by the agent\n");
  await fs.writeFile(path.join(root, "AGENTS.md"), "edited again\n");
  set_authorization(chat, [user("u1", 1), user("u2", 20, "plan_accept")]);
  const after_plan = await instruction_snapshot(chat, root, human_requests_of(chat));
  assert.equal(after_plan.anchor, "u2");
  assert.equal(after_plan.files[0]?.text, "edited again\n");
  forget_instruction_files(chat);
  clear_authorization(chat);
});

test("a steer refreshes the snapshot when it arrives, so a later agent edit stays an agent edit", async () => {
  const root = await project();
  const chat = "instr-e";
  set_authorization(chat, [user("u1", 1)]);
  await instruction_snapshot(chat, root, human_requests_of(chat));
  await fs.writeFile(path.join(root, "AGENTS.md"), "before the steer\n");
  add_authorization(chat, "steer-1", "keep going", undefined, [], Date.now() + 10);
  await refresh_instruction_snapshot(chat);
  await fs.writeFile(path.join(root, "AGENTS.md"), "after the steer\n");
  const snapshot = await instruction_snapshot(chat, root, human_requests_of(chat));
  assert.equal(snapshot.anchor, "steer-1");
  assert.equal(snapshot.files[0]?.text, "before the steer\n");
  assert.match((await agent_edits(chat, root)).text, /-before the steer\n\+after the steer/);
  await refresh_instruction_snapshot("instr-unknown");
  forget_instruction_files(chat);
  clear_authorization(chat);
});

test("forgetting clears one chat only, and only root instruction files count", async () => {
  const root = await project();
  set_authorization("instr-c", [user("u1", 1)]);
  set_authorization("instr-d", [user("u1", 1)]);
  await instruction_snapshot("instr-c", root, human_requests_of("instr-c"));
  await instruction_snapshot("instr-d", root, human_requests_of("instr-d"));
  forget_instruction_files("instr-c");
  await fs.writeFile(path.join(root, "AGENTS.md"), "changed\n");
  assert.equal((await agent_edits("instr-c", root)).text, "");
  assert.notEqual((await agent_edits("instr-d", root)).text, "");
  assert.equal(is_instruction_file("agents.md"), true);
  assert.equal(is_instruction_file("docs/AGENTS.md"), false);
  forget_instruction_files("instr-d");
  clear_authorization("instr-c");
  clear_authorization("instr-d");
});

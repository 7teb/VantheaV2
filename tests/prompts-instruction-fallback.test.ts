import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { before, test } from "node:test";
import { create_chat } from "../electron/chats/store.ts";
import { chat_root, instruction_fallback } from "../electron/chats/workspace.ts";
import { agent_edits, forget_instruction_files, instruction_snapshot } from "../electron/permissions/instruction-files.ts";
import { set_authorization, clear_authorization, human_requests_of } from "../electron/permissions/context.ts";
import { instruction_dirs, load_project_docs } from "../electron/prompts/project.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import type { Message } from "../shared/chat.ts";
import { git, scratch, skip_without_git, write } from "./git-kit.ts";
import { listed_project, project_repo, worktree_env } from "./worktree-kit.ts";

const options = { skip: skip_without_git };

before(async () => {
  if (!skip_without_git) await worktree_env();
});

const ignored_rules = { ".gitignore": "CLAUDE.md\n", "AGENTS.md": "tracked agents\n", "apps/web/index.ts": "x\n" };

const user = (id: string): Message => ({ id, role: "user", text: id, attachments: [], origin: "user", created_at: new Date().toISOString() });

const chat_docs = async (chat_id: string, root: string) => load_project_docs(root, await instruction_fallback(chat_id));

test("a worktree chat reads a missing instruction file from its project folder, and its own copy wins", options, async () => {
  const project = await project_repo("instr-project", ignored_rules);
  await write(project, { "CLAUDE.md": "local project rules\n" });
  const meta = await create_worktree_chat(project, "instructions");
  const tree = await chat_root(meta);
  assert.equal(await instruction_fallback(meta.id), project);
  assert.deepEqual(instruction_dirs(tree, project), [tree, project]);
  const docs = await chat_docs(meta.id, tree);
  assert.deepEqual(docs.map((doc) => doc.name), ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(docs[0]?.content, "tracked agents");
  assert.equal(docs[1]?.content, "local project rules");
  await fs.writeFile(path.join(tree, "CLAUDE.md"), "worktree rules\n");
  assert.equal((await chat_docs(meta.id, tree))[1]?.content, "worktree rules");
});

test("a subfolder project falls back to the same subfolder of its project folder", options, async () => {
  const repo = await project_repo("instr-sub", ignored_rules);
  await write(repo, { "apps/web/CLAUDE.md": "local web rules\n" });
  const project = await listed_project(path.join(repo, "apps", "web"));
  const meta = await create_worktree_chat(project, "web rules");
  const tree = await chat_root(meta);
  assert.equal(path.basename(tree), "web");
  assert.equal((await chat_docs(meta.id, tree)).find((doc) => doc.name === "CLAUDE.md")?.content, "local web rules");
});

test("a project that is itself a linked worktree falls back to its own folder, not the main worktree, and plain chats get no fallback", options, async () => {
  const main = await project_repo("instr-linked-main", ignored_rules);
  await write(main, { "CLAUDE.md": "main worktree rules\n" });
  const linked = path.join(await scratch("instr-linked-tree"), "feature");
  git(main, "worktree", "add", "-q", "-b", "feature", linked);
  await write(linked, { "CLAUDE.md": "linked project rules\n" });
  const project = await listed_project(linked);
  const meta = await create_worktree_chat(project, "linked rules");
  const tree = await chat_root(meta);
  assert.equal(await instruction_fallback(meta.id), linked);
  assert.equal((await chat_docs(meta.id, tree)).find((doc) => doc.name === "CLAUDE.md")?.content, "linked project rules");
  const plain = await create_chat(project);
  assert.equal(await instruction_fallback(plain.id), null);
  await fs.rm(path.join(linked, "CLAUDE.md"));
  assert.deepEqual((await chat_docs(plain.id, linked)).map((doc) => doc.name), ["AGENTS.md"]);
});

test("a plain folder has no fallback", async () => {
  const plain = await scratch("instr-plain");
  await fs.writeFile(path.join(plain, "AGENTS.md"), "plain\n");
  assert.deepEqual(instruction_dirs(plain, null), [plain]);
  assert.deepEqual((await load_project_docs(plain)).map((doc) => doc.content), ["plain"]);
});

test("the review snapshot uses the chat's fallback and an agent copy in the worktree counts as an edit", options, async () => {
  const project = await project_repo("instr-snapshot", ignored_rules);
  await write(project, { "CLAUDE.md": "local project rules\n" });
  const meta = await create_worktree_chat(project, "snapshot");
  const tree = await chat_root(meta);
  set_authorization(meta.id, [user("u1")]);
  const snapshot = await instruction_snapshot(meta.id, tree, human_requests_of(meta.id));
  const claude = snapshot.files.find((file) => file.name === "CLAUDE.md");
  assert.equal(claude?.dir, project);
  assert.equal(claude?.text, "local project rules\n");
  assert.equal(snapshot.files.find((file) => file.name === "AGENTS.md")?.dir, tree);
  assert.deepEqual(await agent_edits(meta.id, tree), { text: "", files: [] });
  await fs.writeFile(path.join(tree, "CLAUDE.md"), "agent rules\n");
  const edits = await agent_edits(meta.id, tree);
  assert.deepEqual(edits.files, ["CLAUDE.md"]);
  assert.match(edits.text, /^--- CLAUDE\.md\n-local project rules\n\+agent rules/);
  await fs.rm(path.join(tree, "CLAUDE.md"));
  await fs.writeFile(path.join(project, "CLAUDE.md"), "project changed\n");
  assert.deepEqual((await agent_edits(meta.id, tree)).files, ["CLAUDE.md"]);
  forget_instruction_files(meta.id);
  clear_authorization(meta.id);
});

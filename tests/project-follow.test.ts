import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { create_agent, get_agent, init_agent_store } from "../electron/agents/store.ts";
import { ensure_continuable } from "../electron/agents/runner.ts";
import { chat_meta, create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { chat_root } from "../electron/chats/workspace.ts";
import { init_artifacts, list_artifacts } from "../electron/media/artifacts.ts";
import { init_memory, resolve_pending, retrieve_memories, review_items, store_scan_result } from "../electron/memory/store.ts";
import { find_renamed, read_folder_id } from "../electron/project/folder.ts";
import { check_project_folders, follow_project } from "../electron/project/follow.ts";
import { add_project, find_project, init_settings, update_project } from "../electron/settings/store.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { create_worktree_chat } from "../electron/worktrees/create.ts";
import { boot_chats, make_root } from "./fixtures/legacy/harness.ts";
import { git, skip_without_git } from "./git-kit.ts";

let root = "";

before(async () => {
  root = await make_root("vx-project-follow-");
  set_storage_root(root);
  await boot_chats(root);
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
  await init_memory({ file: path.join(root, "memories.json"), legacy_file: path.join(root, "memories-v2.json") });
});

after(async () => {
  flush_all_sync();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const folder = async (name: string) => {
  const dir = path.join(root, "projects", name);
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

test("a folder keeps its id across a rename and is found again next to the old path", async () => {
  const old_dir = await folder("before");
  const id = await read_folder_id(old_dir);
  const next_dir = path.join(path.dirname(old_dir), "after");
  await fs.rename(old_dir, next_dir);
  assert.equal(await read_folder_id(next_dir), id);
  assert.equal(await find_renamed(old_dir, id), next_dir);
  await fs.mkdir(old_dir);
  assert.notEqual(await read_folder_id(old_dir), id);
  assert.equal(await find_renamed(path.join(path.dirname(old_dir), "gone"), "0:0"), null);
});

test("a renamed project folder moves the project, its chats, memories and images along", async () => {
  const old_dir = await folder("site");
  await add_project(old_dir, await read_folder_id(old_dir));
  const chat = await create_chat(old_dir);
  await store_scan_result(
    { chat_id: chat.id, message_id: "m-follow", content: "in this repo run npm run package", project_path: old_dir },
    [{ kind: "project_rule", key: "project.package", text: "Run npm run package after changes.", evidence: "run npm run package", confidence: 0.95, explicit: true }],
    "scanned",
  );
  for (const item of review_items()) {
    await resolve_pending(item.id, "keep");
  }
  const artifacts_file = path.join(root, "artifacts.json");
  const image = { id: "img_follow_0a1b2c3d.png", kind: "image", title: "", prompt: "", project_path: old_dir, chat_id: chat.id, pinned: false, created_at: "2026-10-07T00:00:00.000Z" };
  await fs.writeFile(artifacts_file, JSON.stringify({ version: 1, artifacts: [image] }));
  await init_artifacts({ file: artifacts_file, legacy_file: path.join(root, "no-artifacts.json"), legacy_root: root, on_change: () => undefined });

  const next_dir = path.join(path.dirname(old_dir), "site-renamed");
  await fs.rename(old_dir, next_dir);
  const moved = chat_meta(chat.id);
  assert.ok(moved);
  assert.equal(await chat_root(moved), next_dir);

  assert.equal(find_project(old_dir), null);
  assert.deepEqual(find_project(next_dir), { path: next_dir, name: "site-renamed", pinned: false, folder_id: await read_folder_id(next_dir) });
  assert.equal(chat_meta(chat.id)?.project_path, next_dir);
  assert.deepEqual(retrieve_memories(next_dir, "package", 5).map((entry) => entry.text), ["Run npm run package after changes."]);
  assert.deepEqual(retrieve_memories(old_dir, "package", 5), []);
  assert.deepEqual(list_artifacts(next_dir).map((entry) => entry.id), [image.id]);
  assert.deepEqual(list_artifacts(old_dir), []);
});

test("a custom project name survives a rename, a missing folder without a recorded id stays as it is", async () => {
  const named = await folder("named");
  await add_project(named, await read_folder_id(named));
  await update_project(named, { name: "My Project" });
  const renamed = path.join(path.dirname(named), "named-2");
  await fs.rename(named, renamed);
  assert.equal(await follow_project(named), renamed);
  assert.equal(find_project(renamed)?.name, "My Project");

  const unknown = path.join(root, "projects", "never-seen");
  await add_project(unknown, "");
  assert.equal(await follow_project(unknown), unknown);
  assert.equal(find_project(unknown)?.path, unknown);
});

test("the startup check records the folder id of projects that existed before ids were kept", async () => {
  const legacy = await folder("legacy");
  await add_project(legacy, "");
  await check_project_folders();
  assert.equal(find_project(legacy)?.folder_id, await read_folder_id(legacy));
});

test("a renamed project folder moves the sub-agents of its chats along, so they can be continued", async () => {
  await init_agent_store(path.join(root, "agents"));
  const old_dir = await folder("agents-site");
  await add_project(old_dir, await read_folder_id(old_dir));
  const chat = await create_chat(old_dir);
  const agent = create_agent({ chat_id: chat.id, name: "Scout", description: "", topic: "", scope: [], model: "m", effort: "", profile: "explore", without_tools: [], project_root: old_dir });
  const other = create_agent({ chat_id: chat.id, name: "Elsewhere", description: "", topic: "", scope: [], model: "m", effort: "", profile: "explore", without_tools: [], project_root: path.join(root, "projects", "other") });
  const next_dir = path.join(path.dirname(old_dir), "agents-site-renamed");
  await fs.rename(old_dir, next_dir);
  const moved = chat_meta(chat.id);
  assert.ok(moved);
  assert.equal(await chat_root(moved), next_dir);
  assert.equal(get_agent(agent.agent_id)?.project_root, next_dir);
  assert.equal(get_agent(other.agent_id)?.project_root, path.join(root, "projects", "other"));
  assert.doesNotThrow(() => ensure_continuable(agent, next_dir));
  await writes_settled(path.join(root, "agents", "index.json"));
  const stored = JSON.parse(await fs.readFile(path.join(root, "agents", "index.json"), "utf8")) as { agents: { agent_id: string; project_root: string }[] };
  assert.equal(stored.agents.find((entry) => entry.agent_id === agent.agent_id)?.project_root, next_dir);
});

test("renaming the main folder repairs the link of its worktree chats", { skip: skip_without_git }, async () => {
  const old_dir = await folder("wt-site");
  git(old_dir, "init", "-q", "-b", "main");
  await fs.writeFile(path.join(old_dir, "a.txt"), "a");
  git(old_dir, "add", "-A");
  git(old_dir, "commit", "-q", "-m", "init");
  await add_project(old_dir, await read_folder_id(old_dir));
  const chat = await create_worktree_chat(old_dir, "rename the main folder");
  const tree = chat.worktree?.path ?? "";
  const next_dir = path.join(path.dirname(old_dir), "wt-site-renamed");
  await fs.rename(old_dir, next_dir);
  const moved = chat_meta(chat.id);
  assert.ok(moved);
  assert.equal(await chat_root(moved), tree);
  assert.equal(chat_meta(chat.id)?.project_path, next_dir);
  assert.equal(path.resolve(git(tree, "rev-parse", "--path-format=absolute", "--git-common-dir").trim()), path.join(next_dir, ".git"));
  assert.equal(git(tree, "status", "--porcelain"), "");
});

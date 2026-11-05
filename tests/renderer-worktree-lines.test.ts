import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMeta, ChatWorktree } from "../shared/chat.ts";
import type { WorktreeWork } from "../shared/ipc/worktrees.ts";
import { chip_tip, eligibility_hint } from "../src/features/composer/worktree-hint.ts";
import { meta_work, target_has_worktree, warning_lines } from "../src/features/sidebar/worktree-warning.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);
const de: Translate = (key, vars) => translate("de", key, vars);

const worktree = (path: string, branch: string): ChatWorktree => ({ path, prefix: "", branch, base: "a".repeat(40), created_at: "2026-10-26T10:00:00.000Z" });

const chat = (id: string, project_path: string, tree?: ChatWorktree): ChatMeta => ({
  id,
  title: `Chat ${id}`,
  project_path,
  workspace: "",
  pinned: false,
  created_at: "2026-10-26T10:00:00.000Z",
  updated_at: "2026-10-26T10:00:00.000Z",
  message_count: 1,
  streaming: false,
  ...(tree ? { worktree: tree } : {}),
});

const work = (patch: Partial<WorktreeWork>): WorktreeWork => ({ chat_id: "c1", title: "Chat", branch: "vx/fix-login", changed: 0, unpushed: 0, missing: false, shared: false, ...patch });

const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

test("the + menu hint names the branch the worktree starts from, or the reason it is unavailable", () => {
  assert.equal(eligibility_hint(t, { kind: "ready", branch: "main", submodules: false }), "From main");
  assert.equal(eligibility_hint(t, { kind: "ready", branch: null, submodules: false }), "From the current commit");
  assert.equal(eligibility_hint(t, { kind: "ready", branch: "dev", submodules: true }), "From dev · Submodules stay empty");
  assert.equal(eligibility_hint(t, { kind: "not_repo" }), "Not a Git repository");
  assert.equal(eligibility_hint(t, { kind: "no_commits", branch: "main" }), "Needs a first commit");
  assert.equal(eligibility_hint(t, { kind: "untracked_folder", branch: "main" }), "Folder is not in the last commit");
  assert.equal(eligibility_hint(t, { kind: "git_missing" }), "Git is not installed");
  assert.equal(eligibility_hint(t, { kind: "programs", keys: ["filter.lfs", "filter.probe"], branch: "main" }), "Repository configuration starts programs (filter.lfs, filter.probe), use a terminal");
  assert.equal(eligibility_hint(de, { kind: "programs", keys: ["filter.lfs"], branch: "main" }), "Repository-Konfiguration startet Programme (filter.lfs), nutze ein Terminal");
  assert.equal(eligibility_hint(t, { kind: "failed", error: "spawn EPERM" }), "Worktree failed: spawn EPERM");
  assert.equal(eligibility_hint(de, { kind: "ready", branch: "main", submodules: true }), "Von main · Submodule bleiben leer");
});

test("the chip tooltip names the base branch and puts the submodule note on its own line", () => {
  assert.equal(chip_tip(t, { kind: "ready", branch: "main", submodules: false }), "New branch and folder for this chat, from main");
  assert.equal(chip_tip(t, { kind: "ready", branch: "main", submodules: true }), "New branch and folder for this chat, from main\nSubmodules stay empty");
  assert.equal(chip_tip(t, { kind: "ready", branch: null, submodules: false }), "New branch and folder for this chat, from the current commit");
  assert.equal(chip_tip(t, null), "New branch and folder for this chat, from the current commit");
});

test("deleting one clean worktree chat says the folder goes and the branch stays", () => {
  const lines = warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, [work({})]);
  assert.deepEqual(lines, [{ text: "Its worktree folder is deleted. The branch vx/fix-login stays.", tone: "plain" }]);
});

test("deleting a dirty worktree chat warns about uncommitted changes and names commits on no remote", () => {
  const lines = warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, [work({ changed: 3, unpushed: 2 })]);
  assert.deepEqual(lines, [
    { text: "Its worktree folder is deleted. The branch vx/fix-login stays.", tone: "plain" },
    { text: "The worktree on vx/fix-login has 3 uncommitted changes. They are deleted with the folder.", tone: "warning" },
    { text: "2 commits are on no remote. They stay on the branch vx/fix-login.", tone: "plain" },
  ]);
  assert.deepEqual(texts(warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, [work({ changed: 1, unpushed: 1 })])).slice(1), [
    "The worktree on vx/fix-login has 1 uncommitted change. It is deleted with the folder.",
    "1 commit is on no remote. It stays on the branch vx/fix-login.",
  ]);
});

test("a missing worktree only reports its unpushed commits, and a worktree a fork keeps is not mentioned", () => {
  assert.deepEqual(texts(warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, [work({ missing: true, unpushed: 4 })])), ["4 commits are on no remote. They stay on the branch vx/fix-login."]);
  assert.deepEqual(warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, [work({ shared: true, changed: 5 })]), []);
  assert.deepEqual(warning_lines(t, { kind: "chats", chat_ids: ["c1"] }, []), []);
});

test("bulk deletes count the worktree folders and list the branches with work at risk", () => {
  const entries = [work({ branch: "vx/a" }), work({ chat_id: "c2", branch: "vx/b", changed: 2 }), work({ chat_id: "c3", branch: "vx/c", unpushed: 1 }), work({ chat_id: "c4", branch: "vx/d", missing: true })];
  assert.deepEqual(warning_lines(t, { kind: "all" }, entries), [
    { text: "3 worktree folders are deleted. Their branches stay.", tone: "plain" },
    { text: "2 worktrees have uncommitted changes or commits on no remote: vx/b, vx/c. Uncommitted changes are deleted, the branches stay.", tone: "warning" },
  ]);
  assert.deepEqual(texts(warning_lines(t, { kind: "project", project_path: "D:\\p" }, [work({ changed: 1 })])), [
    "1 worktree folder is deleted. Its branch stays.",
    "1 worktree has uncommitted changes or commits on no remote: vx/fix-login. Uncommitted changes are deleted, the branch stays.",
  ]);
  assert.deepEqual(warning_lines(t, { kind: "projects" }, []), []);
});

test("the targets match the chats main deletes, project paths compared without case or slash style", () => {
  const chats = [chat("a", "D:\\Work\\App", worktree("C:\\wt\\1\\App", "vx/a")), chat("b", "D:\\Work\\Other"), chat("c", "", undefined)];
  assert.equal(target_has_worktree(chats, { kind: "project", project_path: "d:/work/app" }), true);
  assert.equal(target_has_worktree(chats, { kind: "project", project_path: "D:\\Work\\Other" }), false);
  assert.equal(target_has_worktree(chats, { kind: "chats", chat_ids: ["b", "c"] }), false);
  assert.equal(target_has_worktree(chats, { kind: "chats", chat_ids: ["a"] }), true);
  assert.equal(target_has_worktree(chats, { kind: "projects" }), true);
  assert.equal(target_has_worktree(chats, { kind: "all" }), true);
});

test("without the live counts, each worktree folder is listed once and a fork outside the target keeps it", () => {
  const shared_tree = worktree("C:\\wt\\1\\App", "vx/a");
  const chats = [chat("a", "D:\\App", shared_tree), chat("a2", "D:\\App", shared_tree), chat("b", "D:\\App", worktree("C:\\wt\\2\\App", "vx/b"))];
  assert.deepEqual(
    meta_work(chats, { kind: "project", project_path: "D:\\App" }).map((entry) => [entry.branch, entry.shared]),
    [
      ["vx/a", false],
      ["vx/b", false],
    ],
  );
  assert.deepEqual(
    meta_work(chats, { kind: "chats", chat_ids: ["a"] }).map((entry) => [entry.branch, entry.shared]),
    [["vx/a", true]],
  );
});

import { draft_browser_chat } from "../../shared/ipc/browser.ts";
import type { WorktreeTarget } from "../../shared/ipc/worktrees.ts";
import { adopt_tabs } from "../browser/tabs.ts";
import { known_project_dir } from "../project/follow.ts";
import { require_record, require_string } from "../storage/coerce.ts";
import { create_worktree_chat } from "../worktrees/create.ts";
import { worktree_eligibility } from "../worktrees/eligibility.ts";
import { chat_worktree_head } from "../worktrees/head.ts";
import { restore_worktree } from "../worktrees/restore.ts";
import { target_work } from "../worktrees/work.ts";
import { handle } from "./handle.ts";

const chat_id = (value: unknown) => require_string(value, "chat id", 200);

const parse_target = (value: unknown): WorktreeTarget => {
  const raw = require_record(value, "worktree target");
  switch (raw.kind) {
    case "chats":
      if (!Array.isArray(raw.chat_ids)) {
        throw new Error("worktree target chat ids must be an array");
      }
      return { kind: "chats", chat_ids: raw.chat_ids.map(chat_id) };
    case "project":
      return { kind: "project", project_path: require_string(raw.project_path, "project path", 2000) };
    case "projects":
    case "all":
      return { kind: raw.kind };
    default:
      throw new Error(`unknown worktree target kind ${String(raw.kind)}`);
  }
};

export const register_worktrees_ipc = () => {
  handle("worktrees:eligibility", async (project_path) => worktree_eligibility(await known_project_dir(project_path)));
  handle("worktrees:create_chat", async (project_path, seed_text) => {
    const meta = await create_worktree_chat(require_string(project_path, "project path", 2000), require_string(seed_text, "seed text", 200_000));
    adopt_tabs(draft_browser_chat, meta.id);
    return meta;
  });
  handle("worktrees:work", (target) => target_work(parse_target(target)));
  handle("worktrees:head", (id) => chat_worktree_head(chat_id(id)));
  handle("worktrees:restore", (id) => restore_worktree(chat_id(id)));
};

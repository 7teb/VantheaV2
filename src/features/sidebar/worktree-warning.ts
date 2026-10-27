import type { ChatMeta } from "../../../shared/chat.ts";
import type { WorktreeTarget, WorktreeWork } from "../../../shared/ipc/worktrees.ts";
import type { Translate } from "../../i18n/translate.ts";
import { normalize_path } from "./sidebar-model.ts";

export type WarningLine = { text: string; tone: "plain" | "warning" };

const in_target = (target: WorktreeTarget, chat: ChatMeta): boolean => {
  switch (target.kind) {
    case "chats":
      return target.chat_ids.includes(chat.id);
    case "project":
      return normalize_path(chat.project_path) === normalize_path(target.project_path);
    case "projects":
      return chat.project_path !== "";
    case "all":
      return true;
  }
};

export const target_has_worktree = (chats: ChatMeta[], target: WorktreeTarget): boolean => chats.some((chat) => chat.worktree !== undefined && in_target(target, chat));

export const meta_work = (chats: ChatMeta[], target: WorktreeTarget): WorktreeWork[] => {
  const seen = new Set<string>();
  const work: WorktreeWork[] = [];
  for (const chat of chats) {
    if (!chat.worktree || !in_target(target, chat) || seen.has(normalize_path(chat.worktree.path))) continue;
    const path = normalize_path(chat.worktree.path);
    seen.add(path);
    const shared = chats.some((other) => other.worktree !== undefined && !in_target(target, other) && normalize_path(other.worktree.path) === path);
    work.push({ chat_id: chat.id, title: chat.title, branch: chat.worktree.branch, changed: 0, unpushed: 0, missing: false, shared });
  }
  return work;
};

const single_lines = (t: Translate, entry: WorktreeWork): WarningLine[] => {
  const { branch, changed, unpushed } = entry;
  const lines: WarningLine[] = [];
  if (!entry.missing) {
    lines.push({ text: t("worktree.delete_one", { branch }), tone: "plain" });
  }
  if (changed > 0) {
    lines.push({ text: changed === 1 ? t("worktree.delete_changes_one", { branch }) : t("worktree.delete_changes", { branch, n: changed }), tone: "warning" });
  }
  if (unpushed > 0) {
    lines.push({ text: unpushed === 1 ? t("worktree.delete_unpushed_one", { branch }) : t("worktree.delete_unpushed", { branch, n: unpushed }), tone: "plain" });
  }
  return lines;
};

export const warning_lines = (t: Translate, target: WorktreeTarget, work: WorktreeWork[]): WarningLine[] => {
  const owned = work.filter((entry) => !entry.shared);
  if (target.kind === "chats" && target.chat_ids.length === 1) {
    return owned[0] ? single_lines(t, owned[0]) : [];
  }
  const lines: WarningLine[] = [];
  const present = owned.filter((entry) => !entry.missing).length;
  if (present > 0) {
    lines.push({ text: present === 1 ? t("worktree.delete_folders_one") : t("worktree.delete_folders", { n: present }), tone: "plain" });
  }
  const at_risk = owned.filter((entry) => entry.changed > 0 || entry.unpushed > 0);
  if (at_risk.length > 0) {
    const branches = at_risk.map((entry) => entry.branch).join(", ");
    lines.push({ text: at_risk.length === 1 ? t("worktree.delete_many_one", { branches }) : t("worktree.delete_many", { n: at_risk.length, branches }), tone: "warning" });
  }
  return lines;
};

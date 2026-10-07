import type { ChatMeta } from "../../../shared/chat.ts";
import type { ProjectEntry } from "../../../shared/settings.ts";
import type { Translate } from "../../i18n/translate.ts";

export type ProjectGroup = { project: ProjectEntry; chats: ChatMeta[] };

export type SidebarModel = { pinned: ChatMeta[]; projects: ProjectGroup[]; loose: ChatMeta[] };

export const normalize_path = (path: string) => path.split(/[\\/]+/).filter(Boolean).join("/").toLowerCase();

const newest_first = (left: ChatMeta, right: ChatMeta) => right.updated_at.localeCompare(left.updated_at);

export const build_sidebar = (chats: ChatMeta[], projects: ProjectEntry[]): SidebarModel => {
  const ordered_projects = projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => Number(right.project.pinned) - Number(left.project.pinned) || left.index - right.index)
    .map((entry) => entry.project);
  const entries: ProjectGroup[] = ordered_projects.map((project) => ({ project, chats: [] }));
  const groups = new Map<string, ChatMeta[]>();
  for (const entry of entries) {
    const key = normalize_path(entry.project.path);
    if (!groups.has(key)) {
      groups.set(key, entry.chats);
    }
  }
  const pinned: ChatMeta[] = [];
  const loose: ChatMeta[] = [];
  for (const chat of [...chats].sort(newest_first)) {
    if (chat.pinned) {
      pinned.push(chat);
      continue;
    }
    const group = chat.project_path ? groups.get(normalize_path(chat.project_path)) : undefined;
    if (group) {
      group.push(chat);
      continue;
    }
    loose.push(chat);
  }
  return {
    pinned,
    projects: entries,
    loose,
  };
};

export const sidebar_order = (model: SidebarModel, collapsed: string[]): ChatMeta[] => [
  ...model.pinned,
  ...model.projects.filter((group) => !collapsed.includes(group.project.path)).flatMap((group) => group.chats),
  ...model.loose,
];

export const chat_label = (t: Translate, title: string) => title.trim() || t("sidebar.new_chat");

export const project_label =(project: ProjectEntry) => project.name || project.path.split(/[\\/]/).filter(Boolean).pop() || project.path;

import { useEffect } from "react";
import type { ContextUsage } from "../../../shared/chat.ts";
import { FolderIcon, GitBranchIcon, ListChecksIcon } from "../../components/icons.tsx";
import { ProgressRing } from "../../components/ProgressRing.tsx";
import { compact_tokens } from "../../components/token-count.ts";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import { chats_store } from "../../state/chats.ts";
import { close_panel, composer_panel_store, open_panel } from "../../state/composer-panel.ts";
import { settings_store } from "../../state/settings.ts";
import { set_todos_hidden, todos_hidden_store } from "../../state/todos-hidden.ts";
import { use_store } from "../../state/use-store.ts";
import { load_eligibility, load_head, worktree_store } from "../../state/worktree.ts";
import { project_path_label } from "../sidebar/sidebar-model.ts";
import { use_open_todo_count, use_shown_context } from "./composer-hooks.ts";

type Branch = { name: string; missing: boolean; tip: string | null };

const use_branch = (t: Translate, chat_id: string | null, project_path: string): Branch | null => {
  const worktree = use_store(chats_store, (state) => (chat_id === null ? undefined : state.list.find((chat) => chat.id === chat_id)?.worktree));
  const head = use_store(worktree_store, (state) => (chat_id === null ? undefined : state.heads[chat_id]));
  const eligibility = use_store(worktree_store, (state) => (project_path ? state.eligibility[project_path] : undefined));
  const has_worktree = worktree !== undefined;
  const listed = eligibility !== undefined;

  useEffect(() => {
    if (chat_id !== null && has_worktree) {
      void load_head(chat_id);
    }
  }, [chat_id, has_worktree]);

  useEffect(() => {
    if (project_path && !has_worktree && !listed) {
      void load_eligibility(project_path);
    }
  }, [project_path, has_worktree, listed]);

  if (worktree) {
    const missing = head?.missing === true;
    const name = head === undefined || missing ? worktree.branch : (head.branch ?? head.detached_at?.slice(0, 7) ?? worktree.branch);
    return { name, missing, tip: missing ? t("worktree.title_missing") : t("worktree.title_tip", { path: worktree.path }) };
  }
  const value = eligibility?.status === "ready" ? eligibility.value : null;
  const name = value !== null && "branch" in value ? value.branch : null;
  return name !== null ? { name, missing: false, tip: null } : null;
};

const BranchItem = ({ branch }: { branch: Branch }) => {
  const item = (
    <span className="composer-strip-item" data-missing={branch.missing || undefined}>
      <GitBranchIcon />
      <span className="composer-strip-name">{branch.name}</span>
    </span>
  );
  return branch.tip ? <Tooltip label={branch.tip}>{item}</Tooltip> : item;
};

type ContextButtonProps = { usage: ContextUsage; draft_key: string };

const ContextButton = ({ usage, draft_key }: ContextButtonProps) => {
  const t = use_t();
  const open = use_store(composer_panel_store, (panel) => panel?.key === draft_key && panel.panel === "context");
  const ratio = Math.min(1, usage.used / usage.limit);
  const percent = Math.round(ratio * 100);
  return (
    <button
      type="button"
      className="composer-strip-context"
      aria-expanded={open}
      aria-label={t("composer.context_usage", { used: compact_tokens(usage.used), limit: compact_tokens(usage.limit), percent })}
      data-level={percent >= 90 ? "high" : undefined}
      onClick={() => (open ? close_panel(draft_key, "context") : open_panel(draft_key, "context"))}
    >
      <ProgressRing ratio={ratio} size={16} />
      <span>{percent}%</span>
    </button>
  );
};

const TodosButton = ({ chat_id, count }: { chat_id: string; count: number }) => {
  const t = use_t();
  const hidden = use_store(todos_hidden_store, (state) => state.has(chat_id));
  const label = t(hidden ? "composer.todos_show" : "composer.todos_hide", { n: count });
  return (
    <Tooltip label={label}>
      <button type="button" className="composer-strip-todos" aria-expanded={!hidden} aria-label={label} onClick={() => set_todos_hidden(chat_id, !hidden)}>
        <ListChecksIcon />
        <span>{count}</span>
      </button>
    </Tooltip>
  );
};

type ComposerStripProps = { chat_id: string | null; project_path: string; draft_key: string };

export const ComposerStrip = ({ chat_id, project_path, draft_key }: ComposerStripProps) => {
  const t = use_t();
  const branch = use_branch(t, chat_id, project_path);
  const projects = use_store(settings_store, (view) => view?.projects ?? null);
  const { usage } = use_shown_context(chat_id);
  const open_todos = use_open_todo_count(chat_id);
  const folder = project_path ? project_path_label(projects ?? [], project_path) : null;
  const measured = usage && usage.limit > 0 ? usage : null;
  if (!branch && !folder && !measured && !open_todos) {
    return null;
  }
  return (
    <div className="composer-strip">
      {branch && <BranchItem branch={branch} />}
      {folder && (
        <span className="composer-strip-item" title={project_path}>
          <FolderIcon />
          <span className="composer-strip-name">{folder}</span>
        </span>
      )}
      {chat_id !== null && open_todos > 0 && <TodosButton chat_id={chat_id} count={open_todos} />}
      {measured && <ContextButton usage={measured} draft_key={draft_key} />}
    </div>
  );
};

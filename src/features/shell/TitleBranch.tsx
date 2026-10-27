import { useEffect } from "react";
import { GitBranchIcon } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store } from "../../state/chats.ts";
import { use_store } from "../../state/use-store.ts";
import { load_head, worktree_store } from "../../state/worktree.ts";
import "./TitleBranch.css";

export const TitleBranch = ({ chat_id }: { chat_id: string | null }) => {
  const t = use_t();
  const worktree = use_store(chats_store, (state) => (chat_id === null ? undefined : state.list.find((chat) => chat.id === chat_id)?.worktree));
  const head = use_store(worktree_store, (state) => (chat_id === null ? undefined : state.heads[chat_id]));
  const has_worktree = worktree !== undefined;

  useEffect(() => {
    if (chat_id !== null && has_worktree) {
      void load_head(chat_id);
    }
  }, [chat_id, has_worktree]);

  if (!worktree) {
    return null;
  }
  const missing = head?.missing === true;
  const name = head === undefined || missing ? worktree.branch : (head.branch ?? head.detached_at?.slice(0, 7) ?? worktree.branch);
  return (
    <Tooltip label={missing ? t("worktree.title_missing") : t("worktree.title_tip", { path: worktree.path })}>
      <span className="title-branch" data-missing={missing}>
        <GitBranchIcon size={13} />
        <span className="title-branch-name">{name}</span>
      </span>
    </Tooltip>
  );
};

import { useEffect, type ReactNode } from "react";
import { WorktreeIcon } from "../../components/icons.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ToggleTrack } from "../../components/Toggle.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store } from "../../state/chats.ts";
import { use_store } from "../../state/use-store.ts";
import { load_eligibility, toggle_worktree, worktree_store } from "../../state/worktree.ts";
import { MenuRow } from "./MenuRow.tsx";
import { eligibility_hint } from "./worktree-hint.ts";

type WorktreeRowProps = { open: boolean; chat_id: string | null; project_path: string; draft_key: string; index: number };

export const WorktreeRow = ({ open, chat_id, project_path, draft_key, index }: WorktreeRowProps) => {
  const t = use_t();
  const fresh = chat_id === null && project_path !== "";
  const load = use_store(worktree_store, (state) => state.eligibility[project_path]);
  const chosen = use_store(worktree_store, (state) => state.choices[draft_key] === true);
  const in_worktree = use_store(chats_store, (state) => chat_id !== null && state.list.some((chat) => chat.id === chat_id && chat.worktree !== undefined));

  useEffect(() => {
    if (open && fresh) {
      void load_eligibility(project_path);
    }
  }, [open, fresh, project_path]);

  const hint = (): ReactNode => {
    if (chat_id !== null) {
      return t("worktree.only_new");
    }
    if (project_path === "") {
      return t("commands.needs_project");
    }
    if (load?.status !== "ready") {
      return <Skeleton width={96} height={10} radius={5} />;
    }
    return eligibility_hint(t, load.value);
  };

  const checked = chat_id === null ? chosen : in_worktree;
  const available = fresh && load?.status === "ready" && load.value.kind === "ready";

  return (
    <MenuRow
      icon={WorktreeIcon}
      label={t("worktree.row")}
      hint={hint()}
      trail={<ToggleTrack checked={checked} />}
      role="menuitemcheckbox"
      checked={checked}
      disabled={!available}
      index={index}
      on_select={() => toggle_worktree(draft_key)}
    />
  );
};

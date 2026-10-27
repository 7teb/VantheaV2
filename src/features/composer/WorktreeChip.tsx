import { CloseIcon, WorktreeIcon } from "../../components/icons.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_t } from "../../i18n/index.ts";
import { use_store } from "../../state/use-store.ts";
import { toggle_worktree, worktree_store } from "../../state/worktree.ts";
import { chip_tip } from "./worktree-hint.ts";

type WorktreeChipProps = { draft_key: string; project_path: string };

export const WorktreeChip = ({ draft_key, project_path }: WorktreeChipProps) => {
  const t = use_t();
  const chosen = use_store(worktree_store, (state) => state.choices[draft_key] === true);
  const eligibility = use_store(worktree_store, (state) => {
    const load = state.eligibility[project_path];
    return load?.status === "ready" ? load.value : null;
  });
  if (!chosen) {
    return null;
  }
  return (
    <Tooltip label={chip_tip(t, eligibility)}>
      <button
        type="button"
        className="composer-chip draft-chip"
        data-active
        data-kind="worktree"
        aria-pressed
        aria-label={t("worktree.chip_remove")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => toggle_worktree(draft_key)}
      >
        <span className="draft-chip-icon">
          <WorktreeIcon size={15} />
          <CloseIcon size={15} />
        </span>
        <span className="composer-chip-label">{t("worktree.row")}</span>
      </button>
    </Tooltip>
  );
};

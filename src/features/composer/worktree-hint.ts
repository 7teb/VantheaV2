import type { WorktreeEligibility } from "../../../shared/ipc/worktrees.ts";
import type { Translate } from "../../i18n/translate.ts";

export const eligibility_hint = (t: Translate, eligibility: WorktreeEligibility): string => {
  switch (eligibility.kind) {
    case "ready": {
      const from = eligibility.branch === null ? t("worktree.from_commit") : t("worktree.from", { branch: eligibility.branch });
      return eligibility.submodules ? `${from} · ${t("worktree.submodules")}` : from;
    }
    case "not_repo":
      return t("worktree.not_repo");
    case "no_commits":
      return t("worktree.no_commits");
    case "untracked_folder":
      return t("worktree.untracked");
    case "git_missing":
      return t("worktree.git_missing");
    case "programs":
      return t("git_actions.programs", { keys: eligibility.keys.join(", ") });
    case "failed":
      return t("commands.failed", { action: t("worktree.row"), error: eligibility.error });
  }
};

export const chip_tip = (t: Translate, eligibility: WorktreeEligibility | null): string => {
  const ready = eligibility?.kind === "ready" ? eligibility : null;
  const tip = ready?.branch ? t("worktree.chip_tip", { branch: ready.branch }) : t("worktree.chip_tip_commit");
  return ready?.submodules ? `${tip}\n${t("worktree.submodules")}` : tip;
};

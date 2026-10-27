import { useEffect } from "react";
import type { WorktreeTarget } from "../../../shared/ipc/worktrees.ts";
import { SkeletonLines } from "../../components/Skeleton.tsx";
import { use_t } from "../../i18n/index.ts";
import { chats_store } from "../../state/chats.ts";
import { use_store } from "../../state/use-store.ts";
import { load_work, work_key, worktree_store } from "../../state/worktree.ts";
import { meta_work, target_has_worktree, warning_lines, type WarningLine } from "./worktree-warning.ts";
import "./WorktreeWarning.css";

export const WorktreeWarning = ({ target }: { target: WorktreeTarget }) => {
  const t = use_t();
  const key = work_key(target);
  const chats = use_store(chats_store, (state) => state.list);
  const relevant = target_has_worktree(chats, target);
  const load = use_store(worktree_store, (state) => state.work[key]);

  useEffect(() => {
    if (relevant) {
      void load_work(target);
    }
  }, [key, relevant]);

  if (!relevant) {
    return null;
  }
  if (load === undefined || load.status === "loading") {
    return (
      <div className="worktree-warning" aria-busy="true">
        <SkeletonLines widths={[84]} height={12} />
      </div>
    );
  }
  const lines: WarningLine[] =
    load.status === "ready" ? warning_lines(t, target, load.work) : [...warning_lines(t, target, meta_work(chats, target)), { text: t("worktree.work_unknown"), tone: "warning" }];
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="worktree-warning">
      {lines.map((line) => (
        <p key={line.text} className="worktree-warning-line" data-tone={line.tone}>
          {line.text}
        </p>
      ))}
    </div>
  );
};

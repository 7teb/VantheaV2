import { Button } from "../../../components/Button.tsx";
import { use_t } from "../../../i18n/index.ts";
import { use_store } from "../../../state/use-store.ts";
import { restore_worktree, worktree_store } from "../../../state/worktree.ts";
import { WorkingLetters } from "../../../components/WorkingLetters.tsx";
import "./WorktreeMissing.css";

type WorktreeMissingProps = { chat_id: string; path: string };

export const WorktreeMissing = ({ chat_id, path }: WorktreeMissingProps) => {
  const t = use_t();
  const restoring = use_store(worktree_store, (state) => state.restoring[chat_id] === true);
  const error = use_store(worktree_store, (state) => state.restore_errors[chat_id] ?? null);
  return (
    <div className="worktree-missing">
      <p className="worktree-missing-text">{t("worktree.missing")}</p>
      <p className="worktree-missing-path">{path}</p>
      <Button className="worktree-missing-restore" disabled={restoring} onClick={() => void restore_worktree(chat_id)}>
        <span className={restoring ? "is-working" : undefined}><WorkingLetters text={t(restoring ? "worktree.restoring" : "worktree.restore")} active={restoring} /></span>
      </Button>
      {error && (
        <p className="worktree-missing-error" role="alert">
          {t("worktree.restore_failed", { error })}
        </p>
      )}
    </div>
  );
};

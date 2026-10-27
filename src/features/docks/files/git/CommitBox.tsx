import type { GitRepoView } from "../../../../../shared/git-view.ts";
import { max_commit_message } from "../../../../../shared/ipc/git-actions.ts";
import { Button, IconButton } from "../../../../components/Button.tsx";
import { RetryIcon } from "../../../../components/icons.tsx";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { TextArea } from "../../../../components/TextField.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";
import { files_store, shown_view } from "../../../../state/files.ts";
import { actions_of, commit_changes, git_actions_store, set_commit_message, write_commit_message, type RootActions } from "../../../../state/git-actions.ts";
import { commit_count, shown_root } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";
import { use_chat_busy } from "../../../composer/composer-hooks.ts";
import { ActionNotice } from "./ActionNotice.tsx";
import { commit_notice } from "./git-notices.ts";
import { WorkingLetters } from "../../../../components/WorkingLetters.tsx";
import "./CommitBox.css";

const blocked_reason = (t: Translate, view: GitRepoView, actions: RootActions, busy: boolean): string | null => {
  if (busy) return t("commands.turn_running");
  if (view.operation) return t("git_actions.finish_operation");
  if (view.entries.some((entry) => entry.status === "conflicted")) return t("git_actions.resolve_conflicts");
  const keys = actions.guard?.commit_block ?? [];
  return keys.length > 0 ? t("git_actions.programs", { keys: keys.join(", ") }) : null;
};

const button_label = (t: Translate, actions: RootActions, files: number) => {
  const { commit } = actions;
  if (commit.writing) return <span className="is-working"><WorkingLetters text={t("git_actions.writing")} /></span>;
  if (commit.committing) return <span className="is-working"><WorkingLetters text={t("git_actions.committing")} /></span>;
  if (!commit.message.trim()) return t("git_actions.write");
  return files === 1 ? t("git_actions.commit_one") : t("git_actions.commit", { n: files });
};

export const CommitBox = ({ view }: { view: GitRepoView }) => {
  const t = use_t();
  const root = use_store(files_store, shown_root);
  const chat_id = use_store(files_store, (state) => shown_view(state).scope.chat_id);
  const busy = use_chat_busy(chat_id);
  const actions = use_store(git_actions_store, (state) => actions_of(state, root));
  const { commit } = actions;
  const files = commit_count(view);
  const reason = blocked_reason(t, view, actions, busy);
  const running = commit.writing || commit.committing;
  const has_text = commit.message.trim() !== "";
  const left_out = commit.left_out.length > 0 ? t("git_actions.left_out", { names: commit.left_out.join(", ") }) : null;
  const quiet = reason ?? (actions.guard?.hooks_off ? t("git_actions.hooks_off") : null);
  if (root === null) {
    return null;
  }
  return (
    <div className="commit-box">
      <div className="commit-well">
        {commit.writing ? (
          <div className="commit-writing inset-surface" aria-busy="true">
            <Skeleton width="72%" height={10} radius={4} />
            <Skeleton width="48%" height={10} radius={4} />
          </div>
        ) : (
          <TextArea
            className="commit-input"
            value={commit.message}
            on_change={(value) => set_commit_message(root, value)}
            placeholder={t("git_actions.message")}
            aria-label={t("git_actions.message")}
            rows={2}
            auto_grow
            max_height={170}
            maxLength={max_commit_message}
            disabled={commit.committing}
            spellCheck
          />
        )}
        {has_text && !running && (
          <IconButton className="commit-retry" size="sm" label={t("git_actions.write_again")} disabled={reason !== null} onClick={() => void write_commit_message()}>
            <RetryIcon size={14} />
          </IconButton>
        )}
      </div>
      <Button className="commit-button" disabled={running || reason !== null || files === 0} onClick={() => void (has_text ? commit_changes() : write_commit_message())}>
        {button_label(t, actions, files)}
      </Button>
      {left_out && (
        <Tooltip label={commit.left_out.join("\n")} placement="top-start">
          <span className="commit-note" tabIndex={0}>
            {left_out}
          </span>
        </Tooltip>
      )}
      {quiet && <span className="commit-note">{quiet}</span>}
      {commit.issue && <ActionNotice notice={commit_notice(t, commit.issue)} />}
    </div>
  );
};

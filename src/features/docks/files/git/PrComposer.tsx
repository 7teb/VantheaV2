import type { PrCli } from "../../../../../shared/ipc/git-actions.ts";
import { max_pr_body, max_pr_title } from "../../../../../shared/ipc/git-actions.ts";
import { Button, IconButton } from "../../../../components/Button.tsx";
import { CloseIcon, ExternalLinkIcon, LockIcon } from "../../../../components/icons.tsx";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { TextArea, TextField } from "../../../../components/TextField.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";
import { open_external } from "../../../../state/chat-actions.ts";
import { files_store, shown_view } from "../../../../state/files.ts";
import { close_pr, create_pr, git_pr_store, pr_of, set_pr_text, type PrDraft } from "../../../../state/git-pr.ts";
import { shown_root } from "../../../../state/git.ts";
import { github_store, github_view_of } from "../../../../state/github.ts";
import { use_store } from "../../../../state/use-store.ts";
import { use_chat_busy } from "../../../composer/composer-hooks.ts";
import { ActionNotice } from "./ActionNotice.tsx";
import { DownloadCli } from "./GithubRow.tsx";
import { GitNotice } from "./GitNotice.tsx";
import { pr_notice } from "./git-notices.ts";
import { use_shown_git } from "./use-shown-git.ts";
import { WorkingLetters } from "../../../../components/WorkingLetters.tsx";
import "./PrComposer.css";

const CliRow = ({ cli, host }: { cli: PrCli; host: string }) => {
  const t = use_t();
  const icon = <LockIcon size={16} />;
  if (cli.command !== null) {
    return <GitNotice icon={icon} title={t("github.cli_host", { host })} command={cli.command} command_tip={t("git_actions.pr_login_tip")} />;
  }
  const title = cli.cli.state === "too_old" ? (cli.cli.version ? t("github.cli_too_old", { version: cli.cli.version }) : t("github.cli_too_old_plain")) : t("git_actions.pr_cli_missing");
  return <GitNotice icon={icon} title={title} action={<DownloadCli />} />;
};

const push_note = (t: Translate, draft: PrDraft, remote: string | null): string | null => {
  if (draft.push_first === null || remote === null) return null;
  if (draft.push_first === 0) return t("git_actions.pr_push_branch", { remote });
  return t("git_actions.pr_push_first", { commits: draft.push_first === 1 ? t("git.commits_one") : t("git.commits", { n: draft.push_first }), remote });
};

const Fields = ({ root, draft }: { root: string; draft: PrDraft }) => {
  const t = use_t();
  if (draft.writing) {
    return (
      <>
        <div className="pr-field-skeleton inset-surface" aria-busy="true">
          <Skeleton width="60%" height={10} radius={4} />
        </div>
        <div className="pr-body-skeleton inset-surface" aria-busy="true">
          <Skeleton width="90%" height={10} radius={4} />
          <Skeleton width="75%" height={10} radius={4} />
          <Skeleton width="50%" height={10} radius={4} />
        </div>
      </>
    );
  }
  return (
    <>
      <TextField
        className="pr-title"
        value={draft.title}
        on_change={(title) => set_pr_text(root, { title })}
        placeholder={t("git_actions.pr_title")}
        aria-label={t("git_actions.pr_title")}
        maxLength={max_pr_title}
        disabled={draft.creating}
        spellCheck
      />
      <TextArea
        className="pr-body"
        value={draft.body}
        on_change={(body) => set_pr_text(root, { body })}
        placeholder={t("git_actions.pr_body")}
        aria-label={t("git_actions.pr_body")}
        rows={3}
        auto_grow
        max_height={220}
        maxLength={max_pr_body}
        disabled={draft.creating}
        spellCheck
      />
    </>
  );
};

export const PrComposer = () => {
  const t = use_t();
  const root = use_store(files_store, shown_root);
  const chat_id = use_store(files_store, (state) => shown_view(state).scope.chat_id);
  const busy = use_chat_busy(chat_id);
  const draft = use_store(git_pr_store, (state) => pr_of(state, root));
  const git = use_shown_git();
  const host = use_store(github_store, (state) => {
    const view = github_view_of(state, root);
    return view.kind === "none" ? null : view.repo.host;
  });
  if (root === null || !draft.open || git.kind !== "repo") {
    return null;
  }
  const note = push_note(t, draft, git.primary_remote);
  const exists = draft.issue?.kind === "exists" ? draft.issue.url : null;
  const ready = !draft.writing && !draft.creating && draft.cli === null && draft.base !== null && draft.title.trim() !== "" && !busy;
  return (
    <div className="pr-composer-slot">
      <section className="pr-composer" aria-label={t("git_actions.pr_label")}>
        <header className="pr-head">
          <span className="section-label">{t("git_actions.pr_label")}</span>
          {draft.base !== null && <span className="pr-into">{t("git_actions.pr_into", { base: draft.base })}</span>}
          <IconButton className="pr-close" size="sm" label={t("common.close")} onClick={() => close_pr(root)}>
            <CloseIcon size={14} />
          </IconButton>
        </header>
        {draft.cli ? <CliRow cli={draft.cli} host={host ?? ""} /> : <Fields root={root} draft={draft} />}
        {draft.issue && (
          <ActionNotice
            notice={pr_notice(t, draft.issue)}
            action={
              exists && (
                <Button size="sm" variant="ghost" icon_end={<ExternalLinkIcon size={14} />} onClick={() => open_external(exists)}>
                  {t("github.open")}
                </Button>
              )
            }
          />
        )}
        <footer className="pr-foot">
          <span className="pr-push-note">{note}</span>
          <Button size="sm" variant="ghost" onClick={() => close_pr(root)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!ready} onClick={() => void create_pr()}>
            {draft.creating ? <span className="is-working"><WorkingLetters text={t("git_actions.creating")} /></span> : t("git_actions.create")}
          </Button>
        </footer>
      </section>
    </div>
  );
};

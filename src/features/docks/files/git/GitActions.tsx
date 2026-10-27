import { useEffect, type ReactNode } from "react";
import type { GitRepoView } from "../../../../../shared/git-view.ts";
import type { GithubRepoView } from "../../../../../shared/github-view.ts";
import { pr_head, pushable, tracked_branch } from "../../../../../shared/git/push-state.ts";
import { Button } from "../../../../components/Button.tsx";
import { CloudAlertIcon, GitPullRequestIcon, PushIcon } from "../../../../components/icons.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";
import { files_store, shown_view } from "../../../../state/files.ts";
import { action_target, actions_of, git_actions_store, load_write_guard, push_branch } from "../../../../state/git-actions.ts";
import { close_pr, git_pr_store, open_pr, pr_of } from "../../../../state/git-pr.ts";
import { shown_root } from "../../../../state/git.ts";
import { github_store, github_view_of } from "../../../../state/github.ts";
import { use_store } from "../../../../state/use-store.ts";
import { use_chat_busy } from "../../../composer/composer-hooks.ts";
import { GitNotice } from "./GitNotice.tsx";
import { push_notice } from "./git-notices.ts";
import { WorkingLetters } from "../../../../components/WorkingLetters.tsx";
import "./GitActions.css";

const push_tip = (t: Translate, view: GitRepoView, remote: string): string => {
  const tracked = tracked_branch(view, remote);
  const ahead = view.branch.ahead ?? 0;
  if (tracked !== null && !view.branch.upstream_gone && ahead > 0) {
    return t("git_actions.push_tip", { commits: ahead === 1 ? t("git.commits_one") : t("git.commits", { n: ahead }), upstream: `${remote}/${tracked}` });
  }
  return t("git_actions.push_upstream_tip", { remote, branch: tracked ?? view.branch.name ?? "" });
};

export const can_open_pr = (view: GitRepoView, github: GithubRepoView): boolean => {
  if (github.kind !== "data" || github.default_branch === null || view.operation !== null || view.branch.unborn || view.head === null) return false;
  const head = pr_head(view);
  const open = github.pr !== null && (github.pr.state === "open" || github.pr.state === "draft");
  return head !== null && head !== github.default_branch && !open;
};

const with_tip = (tip: string | null, node: ReactNode) =>
  tip === null ? (
    node
  ) : (
    <Tooltip label={tip} placement="bottom-end">
      {node}
    </Tooltip>
  );

export const GitActions = ({ view }: { view: GitRepoView }) => {
  const t = use_t();
  const root = use_store(files_store, shown_root);
  const chat_id = use_store(files_store, (state) => shown_view(state).scope.chat_id);
  const busy = use_chat_busy(chat_id);
  const actions = use_store(git_actions_store, (state) => actions_of(state, root));
  const github = use_store(github_store, (state) => github_view_of(state, root));
  const draft = use_store(git_pr_store, (state) => pr_of(state, root));
  const remote = view.primary_remote;

  useEffect(() => {
    const at = action_target();
    if (at) void load_write_guard(at);
  }, [root, view.repo.root]);

  const show_push = remote !== null && pushable(view);
  const show_pr = can_open_pr(view, github);
  if (root === null || (!show_push && !show_pr && !actions.push_issue)) {
    return null;
  }
  const blocked = actions.guard?.push_block ?? [];
  const push_block = busy ? t("commands.turn_running") : blocked.length > 0 ? t("git_actions.programs", { keys: blocked.join(", ") }) : null;
  const notice = actions.push_issue ? push_notice(t, actions.push_issue) : null;
  return (
    <>
      {(show_push || show_pr) && (
        <div className="git-actions">
          {show_push &&
            remote !== null &&
            with_tip(
              push_block ?? push_tip(t, view, remote),
              <Button size="sm" icon={<PushIcon size={14} />} disabled={actions.pushing || push_block !== null || draft.creating} onClick={() => void push_branch()}>
                {actions.pushing ? <span className="is-working"><WorkingLetters text={t("git_actions.pushing")} /></span> : t("git_actions.push")}
              </Button>,
            )}
          {show_pr &&
            with_tip(
              busy ? t("commands.turn_running") : null,
              <Button size="sm" icon={<GitPullRequestIcon size={14} />} aria-expanded={draft.open} disabled={busy || actions.pushing} onClick={() => (draft.open ? close_pr(root) : void open_pr())}>
                {t("git_actions.pr")}
              </Button>,
            )}
        </div>
      )}
      {notice && <GitNotice icon={<CloudAlertIcon size={16} />} tone="danger" title={notice.title} detail={notice.detail} mono={notice.detail !== undefined} command={notice.command} command_tip={notice.command_tip} />}
    </>
  );
};

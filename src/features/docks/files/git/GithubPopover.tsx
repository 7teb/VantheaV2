import { Fragment } from "react";
import type { GitRepoView } from "../../../../../shared/git-view.ts";
import type { GithubBranch, GithubData, GithubPr, GithubPrState, GithubReviews } from "../../../../../shared/github-view.ts";
import { ExternalLinkIcon, GitBranchIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, LockIcon, LockOpenIcon } from "../../../../components/icons.tsx";
import { Popover } from "../../../../components/Popover.tsx";
import { use_t, type MessageKey, type Translate } from "../../../../i18n/index.ts";
import { open_external } from "../../../../state/chat-actions.ts";
import { GithubChecks } from "./GithubChecks.tsx";

export const pr_labels: Record<GithubPrState, MessageKey> = {
  open: "github.pr_open",
  draft: "github.pr_draft",
  merged: "github.pr_merged",
  closed: "github.pr_closed",
};

export const PrStateIcon = ({ state, size }: { state: GithubPrState; size: number }) => {
  switch (state) {
    case "open":
      return <GitPullRequestIcon size={size} />;
    case "draft":
      return <GitPullRequestDraftIcon size={size} />;
    case "merged":
      return <GitMergeIcon size={size} />;
    case "closed":
      return <GitPullRequestClosedIcon size={size} />;
  }
};

export const branch_text = (t: Translate, branch: GithubBranch, ahead: number | null, head: string | null): string | null => {
  const local = ahead ?? 0;
  switch (branch.kind) {
    case "none":
      return null;
    case "missing":
      return t("github.branch_missing");
    case "rewritten":
      return t("github.branch_rewritten");
    case "unfetched":
      return t("github.branch_unfetched");
    case "same":
      if (ahead === null && head !== branch.sha) return t("github.branch_differs");
      if (local === 0) return t("github.branch_same");
      return local === 1 ? t("github.branch_local_missing_one") : t("github.branch_local_missing", { n: local });
    case "remote_ahead": {
      const remote = branch.count === 1 ? t("github.branch_remote_ahead_one") : t("github.branch_remote_ahead", { n: branch.count });
      if (local === 0) return remote;
      return local === 1 ? t("github.branch_plus_local_one", { remote }) : t("github.branch_plus_local", { remote, n: local });
    }
  }
};

const reviews_text = (t: Translate, reviews: GithubReviews | null): string | null => {
  if (!reviews) {
    return null;
  }
  const parts = [
    reviews.approved > 0 ? t("github.reviews_approved", { n: reviews.approved }) : null,
    reviews.changes_requested > 0 ? t("github.reviews_changes", { n: reviews.changes_requested }) : null,
    reviews.pending > 0 ? t("github.reviews_pending", { n: reviews.pending }) : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
};

const Parts = ({ parts }: { parts: string[] }) => (
  <>
    {parts.map((part, index) => (
      <Fragment key={part}>
        {index > 0 && <span className="git-sep"> · </span>}
        {part}
      </Fragment>
    ))}
  </>
);

const repo_facts = (t: Translate, view: GithubData): string[] => {
  const visibility = view.visibility === null ? null : t(view.visibility === "public" ? "github.public" : view.visibility === "private" ? "github.private" : "github.internal");
  return [visibility, view.archived ? t("github.archived") : null, view.fork_parent ? t("github.fork_of", { repo: view.fork_parent }) : null].filter((part) => part !== null);
};

const PrRow = ({ pr, on_open }: { pr: GithubPr; on_open: (url: string) => void }) => {
  const t = use_t();
  const sub = [t(pr_labels[pr.state]), reviews_text(t, pr.reviews)].filter((part) => part !== null);
  const body = (
    <>
      <span className="git-row-icon">
        <PrStateIcon state={pr.state} size={16} />
      </span>
      <span className="gh-pop-item-text">
        <span className="gh-pop-item-title">
          #{pr.number} {pr.title}
        </span>
        <span className="gh-pop-item-sub">
          <Parts parts={sub} />
        </span>
      </span>
    </>
  );
  const url = pr.html_url;
  if (url === null) {
    return (
      <div className="gh-pop-item" data-tone={pr.state}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className="gh-pop-item" data-tone={pr.state} onClick={() => on_open(url)}>
      {body}
      <span className="gh-pop-ext">
        <ExternalLinkIcon size={14} />
      </span>
    </button>
  );
};

type GithubPopoverProps = { open: boolean; anchor: HTMLElement | null; on_close: () => void; view: GithubData; git: GitRepoView; foot: string[] };

export const GithubPopover = ({ open, anchor, on_close, view, git, foot }: GithubPopoverProps) => {
  const t = use_t();
  const facts = repo_facts(t, view);
  const branch = branch_text(t, view.branch, git.branch.ahead, git.head);
  const visit = (url: string) => {
    open_external(url);
    on_close();
  };
  const site = view.html_url;
  return (
    <Popover open={open} anchor={anchor} label={t("github.title")} on_close={on_close} placement="bottom-end" className="gh-pop">
      <div className="gh-pop-section">
        <div className="gh-pop-head">
          <span className="git-row-icon">{view.visibility === "public" ? <LockOpenIcon size={16} /> : <LockIcon size={16} />}</span>
          <span className="gh-pop-text">
            <span className="gh-pop-title">
              {view.repo.owner}/{view.repo.name}
            </span>
            {facts.length > 0 && (
              <span className="gh-pop-sub">
                <Parts parts={facts} />
              </span>
            )}
            {view.renamed_from && <span className="gh-pop-sub">{t("github.renamed_from", { name: view.renamed_from })}</span>}
          </span>
        </div>
        {branch !== null && (
          <div className="gh-pop-fact">
            <span className="git-row-icon">
              <GitBranchIcon size={16} />
            </span>
            <span className="gh-pop-text">
              <span className="gh-pop-fact-title">{t("github.branch_title")}</span>
              <span className="gh-pop-sub">{branch}</span>
            </span>
          </div>
        )}
        {site !== null && (
          <button type="button" className="gh-pop-item" onClick={() => visit(site)}>
            <span className="git-row-icon">
              <ExternalLinkIcon size={16} />
            </span>
            <span className="gh-pop-item-text">{t("github.open")}</span>
          </button>
        )}
      </div>
      {view.pr && (
        <div className="gh-pop-section">
          <PrRow pr={view.pr} on_open={visit} />
        </div>
      )}
      {view.checks && <GithubChecks checks={view.checks} on_open={visit} />}
      {foot.length > 0 && (
        <div className="gh-pop-section">
          <div className="gh-pop-foot">
            <Parts parts={foot} />
          </div>
        </div>
      )}
    </Popover>
  );
};

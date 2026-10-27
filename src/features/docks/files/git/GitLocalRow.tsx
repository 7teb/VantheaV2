import { Fragment, type ReactNode } from "react";
import type { FetchState, GitRemote, GitRepoView } from "../../../../../shared/git-view.ts";
import { AheadIcon, BehindIcon, GitBranchIcon, GitCommitIcon } from "../../../../components/icons.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_clock } from "../../../../components/use-clock.ts";
import { use_t, type Translate } from "../../../../i18n/index.ts";
import { relative_time } from "../../../../i18n/relative-time.ts";
import { WorkingLetters } from "../../../../components/WorkingLetters.tsx";

type Tracking = { upstream: string; ahead: number; behind: number };

const tracking_of = (view: GitRepoView): Tracking | null => {
  const { upstream, ahead, behind } = view.branch;
  return upstream !== null && ahead !== null && behind !== null ? { upstream, ahead, behind } : null;
};

const suffix_of = (t: Translate, view: GitRepoView): string | null => {
  const { branch } = view;
  if (branch.name === null) return view.operation?.branch ? null : t("git.detached");
  if (branch.unborn) return t("git.unborn");
  if (branch.upstream !== null && branch.upstream_gone) return t("git.upstream_gone", { upstream: branch.upstream });
  if (branch.upstream === null && view.remotes.length > 0) return t("git.local_only");
  return null;
};

const remote_label = (remote: GitRemote): string => (remote.host && remote.slug ? `${remote.host}/${remote.slug}` : remote.url);

const compare_line = (t: Translate, tracking: Tracking): string =>
  t("git.sync_tip", {
    commits: tracking.ahead === 1 ? t("git.commits_one") : t("git.commits", { n: tracking.ahead }),
    behind: tracking.behind,
    upstream: tracking.upstream,
  });

const branch_tip = (t: Translate, view: GitRepoView, tracking: Tracking | null): string => {
  const lines: string[] = [];
  const remote = view.remotes.find((entry) => entry.name === view.primary_remote);
  if (tracking && remote) lines.push(t("git.upstream_at", { upstream: tracking.upstream, remote: remote_label(remote) }));
  if (tracking) lines.push(compare_line(t, tracking));
  if (view.repo.prefix) lines.push(t("git.subfolder", { repo: view.repo.root, prefix: view.repo.prefix }));
  if (view.repo.superproject) lines.push(t("git.submodule_of", { path: view.repo.superproject }));
  if (view.repo.worktree_of) lines.push(t("git.worktree_of", { path: view.repo.worktree_of }));
  return lines.join("\n");
};

const fetch_text = (t: Translate, at: string | null, now: number): string => {
  if (at === null) {
    return t("git.not_fetched");
  }
  const ago = relative_time(t, at, now);
  return ago === t("time.now") ? t("git.fetched_just_now") : t("git.fetched_ago", { time: ago });
};

const as_of_text = (t: Translate, at: string | null, now: number): string => {
  if (at === null) {
    return t("git.not_fetched");
  }
  const ago = relative_time(t, at, now);
  return ago === t("time.now") ? t("git.as_of_just_now") : t("git.as_of", { time: ago });
};

const fetch_parts = (t: Translate, fetch: FetchState, now: number): string[] =>
  fetch.error?.kind === "offline" ? [t("git.offline"), as_of_text(t, fetch.at, now)] : [fetch_text(t, fetch.at, now)];

const pause_tip = (t: Translate, fetch: FetchState): string => {
  if (fetch.blocked?.kind !== "agent_running") {
    return "";
  }
  return t(fetch.queued ? "git.fetch_queued" : "git.fetch_paused");
};

const with_tip = (tip: string, node: ReactNode) => (tip ? <Tooltip label={tip} placement="bottom-start">{node}</Tooltip> : node);

export const GitLocalRow = ({ view }: { view: GitRepoView }) => {
  const t = use_t();
  const tracking = tracking_of(view);
  const now = use_clock(tracking !== null && view.fetch.at !== null);
  const name = view.branch.name ?? view.operation?.branch ?? null;
  const tip = branch_tip(t, view, tracking);
  const suffix = suffix_of(t, view);
  const parts: { key: string; node: ReactNode }[] = [];
  if (suffix) {
    parts.push({ key: "suffix", node: <span className="git-part git-detail">{suffix}</span> });
  }
  if (tracking) {
    parts.push({
      key: "sync",
      node: with_tip(
        compare_line(t, tracking),
        <span className="git-part git-sync" tabIndex={0}>
          <span className="git-sync-part" data-nonzero={tracking.ahead > 0}>
            <AheadIcon size={14} />
            {tracking.ahead}
          </span>
          <span className="git-sync-part" data-nonzero={tracking.behind > 0}>
            <BehindIcon size={14} />
            {tracking.behind}
          </span>
        </span>,
      ),
    });
  }
  if (view.refreshing) {
    parts.push({ key: "status", node: <span className="git-part is-working"><WorkingLetters text={t("git.reading_status")} /></span> });
  } else if (tracking) {
    const fetch = fetch_parts(t, view.fetch, now);
    const paused = pause_tip(t, view.fetch);
    for (const [index, text] of fetch.entries()) {
      const last = index === fetch.length - 1;
      const node = (
        <span className="git-part git-detail" tabIndex={last && paused ? 0 : undefined}>
          {text}
        </span>
      );
      parts.push({ key: `fetch-${index}`, node: last ? with_tip(paused, node) : node });
    }
  }
  if (view.branch.stash > 0) {
    const stash = view.branch.stash === 1 ? t("git.stash_one") : t("git.stash", { n: view.branch.stash });
    parts.push({ key: "stash", node: <span className="git-part git-detail">{stash}</span> });
  }
  return (
    <div className="git-row">
      <span className="git-row-icon">{name === null ? <GitCommitIcon size={16} /> : <GitBranchIcon size={16} />}</span>
      <span className="git-row-main">
        {with_tip(
          tip,
          <span className="git-part git-branch" tabIndex={tip ? 0 : undefined}>
            {name ?? view.branch.detached_at?.slice(0, 7)}
          </span>,
        )}
        {parts.map((part) => (
          <Fragment key={part.key}>
            <span className="git-sep">·</span>
            {part.node}
          </Fragment>
        ))}
      </span>
    </div>
  );
};

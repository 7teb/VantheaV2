import type { CSSProperties, ReactNode } from "react";
import type { GitOperation, GitRepoView, GitView } from "../../../../../shared/git-view.ts";
import { Button } from "../../../../components/Button.tsx";
import { CircleAlertIcon, ExternalLinkIcon, EyeOffIcon, HourglassIcon, InfoIcon, ShieldAlertIcon } from "../../../../components/icons.tsx";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t, type MessageKey, type Translate } from "../../../../i18n/index.ts";
import { open_external } from "../../../../state/chat-actions.ts";
import { GitActions } from "./GitActions.tsx";
import { GitLocalRow } from "./GitLocalRow.tsx";
import { FetchNotice, GitNotice } from "./GitNotice.tsx";
import { GithubRow } from "./GithubRow.tsx";
import { use_shown_git } from "./use-shown-git.ts";
import "./GitCard.css";

const git_download_url = "https://git-scm.com/download/win";

const operation_labels: Record<GitOperation["kind"], MessageKey> = {
  merge: "git.op_merge",
  rebase: "git.op_rebase",
  am: "git.op_am",
  am_or_rebase: "git.op_am_or_rebase",
  cherry_pick: "git.op_cherry_pick",
  revert: "git.op_revert",
  bisect: "git.op_bisect",
};

const quote_arg = (value: string): string =>
  /^[A-Za-z0-9+,\-./:=@_^]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''").replace(/!/g, "'\\!'")}'`;

const DownloadAction = () => {
  const t = use_t();
  return (
    <Tooltip label={git_download_url.replace(/^https:\/\//, "")}>
      <Button size="sm" icon_end={<ExternalLinkIcon size={14} />} onClick={() => open_external(git_download_url)}>
        {t("git.download")}
      </Button>
    </Tooltip>
  );
};

const OperationRow = ({ operation, conflicts }: { operation: GitOperation; conflicts: number }) => {
  const t = use_t();
  return (
    <div className="git-row" data-tone="waiting" role="status">
      <span className="git-row-icon">
        <HourglassIcon size={16} />
      </span>
      <span className="git-row-main">
        <span className="git-part git-title">{t(operation_labels[operation.kind])}</span>
        {operation.step !== null && operation.total !== null && (
          <>
            <span className="git-sep">·</span>
            <span className="git-part git-detail">{t("git.op_step", { n: operation.step, total: operation.total })}</span>
          </>
        )}
        {conflicts > 0 && (
          <>
            <span className="git-sep">·</span>
            <span className="git-part git-conflict-count">{conflicts === 1 ? t("git.conflict_one") : t("git.conflicts", { n: conflicts })}</span>
          </>
        )}
      </span>
    </div>
  );
};

const repo_rows = (t: Translate, view: GitRepoView): ReactNode => (
  <>
    <GitLocalRow view={view} />
    {view.operation && <OperationRow operation={view.operation} conflicts={view.entries.filter((entry) => entry.status === "conflicted").length} />}
    <FetchNotice fetch={view.fetch} />
    {view.watch_failed && <GitNotice icon={<EyeOffIcon size={16} />} title={t("git.watch_failed")} />}
    <GithubRow git={view} />
    <GitActions view={view} />
  </>
);

const card_rows = (t: Translate, view: Exclude<GitView, { kind: "none" } | { kind: "loading" }>): ReactNode => {
  switch (view.kind) {
    case "git_missing":
      return <GitNotice icon={<CircleAlertIcon size={16} />} title={t("git.missing")} action={<DownloadAction />} />;
    case "git_too_old":
      return (
        <GitNotice
          icon={<CircleAlertIcon size={16} />}
          title={t("git.too_old", { version: view.version })}
          detail={t(view.reason === "partial_clone" ? "git.too_old_partial_detail" : "git.too_old_detail")}
          action={<DownloadAction />}
        />
      );
    case "blocked_ownership":
      return <GitNotice icon={<ShieldAlertIcon size={16} />} title={t("git.blocked_ownership")} command={`git config --global --add safe.directory ${quote_arg(view.path)}`} />;
    case "outside_tracked":
      return <GitNotice icon={<InfoIcon size={16} />} title={t("git.outside_tracked")} detail={t("git.outside_tracked_detail", { repo: view.repo_root })} />;
    case "error":
      return view.broken_gitfile ? (
        <GitNotice icon={<CircleAlertIcon size={16} />} tone="danger" title={t("git.broken_gitfile")} />
      ) : (
        <GitNotice icon={<CircleAlertIcon size={16} />} tone="danger" title={t("git.error")} detail={view.message} mono />
      );
    case "repo":
      return repo_rows(t, view);
  }
};

export const GitCard = () => {
  const t = use_t();
  const view = use_shown_git();
  if (view.kind === "none") {
    return null;
  }
  if (view.kind === "loading") {
    return (
      <div className="git-toolbar delayed-reveal" style={{ "--reveal-delay": "200ms" } as CSSProperties}>
        <div className="git-card" aria-busy="true">
          <div className="git-skeleton-row">
            <Skeleton width={16} height={16} radius={999} />
            <Skeleton width={58} height={10} radius={4} />
            <Skeleton width={112} height={10} radius={4} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="git-toolbar">
      <div className="git-card">{card_rows(t, view)}</div>
    </div>
  );
};

import { Fragment, useState } from "react";
import type { GitRepoView } from "../../../../../shared/git-view.ts";
import type { GithubCli, GithubData, GithubRepoRef, GithubRepoView, GithubStale } from "../../../../../shared/github-view.ts";
import { Button } from "../../../../components/Button.tsx";
import { ClockIcon, CloudOffIcon, ExternalLinkIcon, LockIcon, LockOpenIcon } from "../../../../components/icons.tsx";
import { Skeleton } from "../../../../components/Skeleton.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_language, use_t, type Translate } from "../../../../i18n/index.ts";
import { open_external } from "../../../../state/chat-actions.ts";
import { files_store } from "../../../../state/files.ts";
import { github_store, github_view_of } from "../../../../state/github.ts";
import { shown_root } from "../../../../state/git.ts";
import { use_store } from "../../../../state/use-store.ts";
import { GitNotice } from "./GitNotice.tsx";
import { CheckStateIcon, checks_label } from "./GithubChecks.tsx";
import { GithubPopover, pr_labels, PrStateIcon } from "./GithubPopover.tsx";
import "./Github.css";

const cli_download_url = "https://cli.github.com/";

type Blocked = Exclude<GithubRepoView, { kind: "none" } | { kind: "loading" } | GithubData>;

const slug_of = (repo: GithubRepoRef): string => `${repo.owner}/${repo.name}`;

const clock_of = (language: string, iso: string): string => new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const DownloadCli = () => {
  const t = use_t();
  return (
    <Tooltip label={cli_download_url.replace(/^https:\/\//, "").replace(/\/$/, "")}>
      <Button size="sm" icon_end={<ExternalLinkIcon size={14} />} onClick={() => open_external(cli_download_url)}>
        {t("github.download_cli")}
      </Button>
    </Tooltip>
  );
};

const too_old = (t: Translate, cli: GithubCli): string | undefined => {
  if (cli.state !== "too_old") return undefined;
  return cli.version ? t("github.cli_too_old", { version: cli.version }) : t("github.cli_too_old_plain");
};

const stale_reason = (t: Translate, language: string, stale: GithubStale): string => {
  if (stale.reason === "offline") return t("github.stale_offline");
  if (stale.reason === "rate_limited") return stale.reset_at ? t("github.stale_rate", { time: clock_of(language, stale.reset_at) }) : t("github.rate");
  return stale.status === null ? t("github.stale_server_plain") : t("github.stale_server", { status: stale.status });
};

const BlockedRow = ({ view }: { view: Blocked }) => {
  const t = use_t();
  const language = use_language();
  const lock = <LockIcon size={16} />;
  const command = "command" in view && view.command !== null ? view.command : undefined;
  switch (view.kind) {
    case "cli_host":
      return <GitNotice icon={lock} title={t("github.cli_host", { host: view.repo.host })} command={command} detail={too_old(t, view.cli)} action={command ? undefined : <DownloadCli />} />;
    case "needs_sign_in":
      if (view.reason === "expired") return <GitNotice icon={lock} title={t("github.expired")} command={command} />;
      return (
        <GitNotice
          icon={lock}
          title={slug_of(view.repo)}
          muted_title
          command={command}
          command_tip={t("github.cli_login_tip")}
          detail={too_old(t, view.cli) ?? t("github.not_readable")}
          action={command ? undefined : <DownloadCli />}
        />
      );
    case "no_access":
      return <GitNotice icon={lock} title={t("github.not_visible", { repo: slug_of(view.repo), login: view.login })} command={view.command} />;
    case "sso":
      return (
        <GitNotice
          icon={lock}
          title={t("github.sso", { org: view.org })}
          action={
            <Button size="sm" icon_end={<ExternalLinkIcon size={14} />} onClick={() => open_external(view.url)}>
              {t("github.start_sso")}
            </Button>
          }
        />
      );
    case "unavailable":
      if (view.reason === "rate_limited") {
        const time = view.reset_at ? clock_of(language, view.reset_at) : null;
        return (
          <GitNotice
            icon={<ClockIcon size={16} />}
            title={t("github.rate")}
            detail={time ? t("github.rate_reset", { time }) : undefined}
            command={view.command ?? undefined}
            command_tip={time ? t("github.rate_login_tip", { time }) : t("github.rate_login_tip_plain")}
            action={view.cli ? <DownloadCli /> : undefined}
          />
        );
      }
      if (view.reason === "offline") return <GitNotice icon={<CloudOffIcon size={16} />} title={t("github.offline")} />;
      return <GitNotice icon={<CloudOffIcon size={16} />} title={view.status === null ? t("github.server_error_plain") : t("github.server_error", { status: view.status })} />;
  }
};

const DataRow = ({ view, git }: { view: GithubData; git: GitRepoView }) => {
  const t = use_t();
  const language = use_language();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const stale = view.stale ? [t("github.as_of", { time: clock_of(language, view.updated_at) }), stale_reason(t, language, view.stale)] : [];
  const visibility = view.visibility === null ? null : t(view.visibility === "public" ? "github.public" : view.visibility === "private" ? "github.private" : "github.internal");
  const rest = visibility === null ? t("github.row_tip_plain") : t("github.row_tip", { visibility });
  const tip = view.stale ? t("github.stale_tip", { time: clock_of(language, view.updated_at), reason: stale[1] ?? "", rest }) : rest;
  const icon = view.stale ? <CloudOffIcon size={16} /> : view.visibility === "public" ? <LockOpenIcon size={16} /> : <LockIcon size={16} />;
  const foot = view.stale ? stale : view.source_login ? [t("github.via_cli", { login: view.source_login })] : [];
  return (
    <div className="git-gh-slot">
      <Tooltip label={tip} placement="bottom-start">
        <button ref={set_anchor} type="button" className="git-row git-gh-row" aria-haspopup="dialog" aria-expanded={open} onClick={() => set_open((value) => !value)}>
          <span className="git-row-icon">{icon}</span>
          <span className="git-row-main">
            <span className="git-part git-slug">{slug_of(view.repo)}</span>
            {stale.map((part) => (
              <Fragment key={part}>
                <span className="git-sep">·</span>
                <span className="git-part git-detail">{part}</span>
              </Fragment>
            ))}
          </span>
          {(view.pr || view.checks) && (
            <span className="git-row-end">
              {view.pr && (
                <span className="git-stat" data-tone={view.pr.state}>
                  <PrStateIcon state={view.pr.state} size={14} />#{view.pr.number} {t(pr_labels[view.pr.state])}
                </span>
              )}
              {view.checks && (
                <span className="git-stat" data-tone={view.checks.state}>
                  <CheckStateIcon state={view.checks.state} size={14} />
                  {checks_label(t, view.checks)}
                </span>
              )}
            </span>
          )}
        </button>
      </Tooltip>
      <GithubPopover open={open} anchor={anchor} on_close={() => set_open(false)} view={view} git={git} foot={foot} />
    </div>
  );
};

export const GithubRow = ({ git }: { git: GitRepoView }) => {
  const root = use_store(files_store, shown_root);
  const view = use_store(github_store, (state) => github_view_of(state, root));
  if (view.kind === "none") {
    return null;
  }
  if (view.kind === "loading") {
    return (
      <div className="git-skeleton-row" aria-busy="true">
        <Skeleton width={16} height={16} radius={999} />
        <Skeleton width={96} height={10} radius={4} />
        <span className="git-skeleton-gap" />
        <Skeleton width={64} height={10} radius={4} />
      </div>
    );
  }
  if (view.kind === "data") {
    return <DataRow view={view} git={git} />;
  }
  return <BlockedRow view={view} />;
};

import { check_order } from "../../../../../shared/github/checks.ts";
import type { GithubCheck, GithubCheckState, GithubChecks as Checks } from "../../../../../shared/github-view.ts";
import { CircleAlertIcon, CircleCheckIcon, CircleSlashIcon, CircleSpinnerIcon, CircleXIcon, ExternalLinkIcon } from "../../../../components/icons.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";

export const CheckStateIcon = ({ state, size }: { state: GithubCheckState; size: number }) => {
  switch (state) {
    case "passed":
      return <CircleCheckIcon size={size} />;
    case "failed":
      return <CircleXIcon size={size} />;
    case "running":
      return <CircleSpinnerIcon size={size} className="spin" />;
    case "action_required":
      return <CircleAlertIcon size={size} />;
    case "skipped":
      return <CircleSlashIcon size={size} />;
  }
};

const count_text = (t: Translate, state: GithubCheckState, count: number): string => {
  switch (state) {
    case "failed":
      return t("github.checks_failed", { n: count });
    case "action_required":
      return t("github.checks_action_count", { n: count });
    case "running":
      return count === 1 ? t("github.checks_running_one") : t("github.checks_running", { n: count });
    case "passed":
      return t("github.checks_passed", { n: count });
    case "skipped":
      return t("github.checks_skipped", { n: count });
  }
};

export const checks_label = (t: Translate, checks: Checks): string =>
  checks.state === "action_required" ? t("github.checks_action") : count_text(t, checks.state, checks.counts[checks.state]);

const counts_label = (t: Translate, checks: Checks): string =>
  check_order
    .filter((state) => checks.counts[state] > 0)
    .map((state) => count_text(t, state, checks.counts[state]))
    .join(", ");

export const duration_text = (t: Translate, ms: number): string => {
  const total = Math.max(1, Math.round(ms / 1000));
  const parts = [
    { count: Math.floor(total / 3600), key: "github.unit_h" },
    { count: Math.floor(total / 60) % 60, key: "github.unit_m" },
    { count: total % 60, key: "github.unit_s" },
  ] as const;
  const first = parts.findIndex((part) => part.count > 0);
  return parts
    .slice(first, first + 2)
    .filter((part) => part.count > 0)
    .map((part) => t(part.key, { n: part.count }))
    .join(" ");
};

const duration_of = (t: Translate, check: GithubCheck): string | null =>
  check.started_at !== null && check.completed_at !== null ? duration_text(t, Date.parse(check.completed_at) - Date.parse(check.started_at)) : null;

const CheckRow = ({ check, on_open }: { check: GithubCheck; on_open: (url: string) => void }) => {
  const t = use_t();
  const duration = duration_of(t, check);
  const body = (
    <>
      <span className="git-row-icon">
        <CheckStateIcon state={check.state} size={16} />
      </span>
      <span className="gh-pop-item-text gh-pop-item-name">{check.name}</span>
      {duration !== null && <span className="gh-pop-time">{duration}</span>}
    </>
  );
  if (check.url === null) {
    return (
      <div className="gh-pop-item" data-tone={check.state}>
        {body}
      </div>
    );
  }
  const url = check.url;
  return (
    <button type="button" className="gh-pop-item" data-tone={check.state} onClick={() => on_open(url)}>
      {body}
      <span className="gh-pop-ext">
        <ExternalLinkIcon size={14} />
      </span>
    </button>
  );
};

export const GithubChecks = ({ checks, on_open }: { checks: Checks; on_open: (url: string) => void }) => {
  const t = use_t();
  return (
    <div className="gh-pop-section">
      <div className="gh-pop-label">
        <span className="section-label">{t("github.checks")}</span>
        <span>{counts_label(t, checks)}</span>
      </div>
      {checks.items.map((check, index) => (
        <CheckRow key={`${index}:${check.name}`} check={check} on_open={on_open} />
      ))}
      {checks.limited && <div className="gh-pop-more">{t("github.checks_limit")}</div>}
    </div>
  );
};

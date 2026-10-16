import type { ReactNode } from "react";
import type { FetchBlock, FetchState } from "../../../../../shared/git-view.ts";
import { CircleSlashIcon, CloudAlertIcon } from "../../../../components/icons.tsx";
import { CopyButton } from "../../../../components/MarkdownCopy.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t, type Translate } from "../../../../i18n/index.ts";

type GitNoticeProps = {
  icon: ReactNode;
  title: string;
  muted_title?: boolean;
  detail?: string;
  mono?: boolean;
  command?: string;
  command_tip?: string;
  tone?: "danger";
  action?: ReactNode;
};

export const GitNotice = ({ icon, title, muted_title = false, detail, mono = false, command, command_tip, tone, action }: GitNoticeProps) => {
  const t = use_t();
  const end = command ? <CopyButton text={command} label={t("git.copy_command")} /> : action;
  return (
    <div className="git-row" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <span className="git-row-lead">
        <span className="git-row-icon">{icon}</span>
        <span className="git-row-text">
          <span className={muted_title ? "git-row-title git-slug" : "git-row-title"}>{title}</span>
          {command && (
            <Tooltip label={command_tip ?? command} placement="bottom-start">
              <span className="git-row-command">
                <code>{command}</code>
              </span>
            </Tooltip>
          )}
          {!command && detail && (
            <span className="git-row-detail" data-mono={mono}>
              {detail}
            </span>
          )}
        </span>
      </span>
      {end && <span className="git-row-action">{end}</span>}
    </div>
  );
};

const block_detail = (t: Translate, blocked: Exclude<FetchBlock, { kind: "agent_running" }>): string => {
  switch (blocked.kind) {
    case "insecure_transport":
      return t("git.autofetch_insecure");
    case "repo_config":
      return t("git.autofetch_programs", { keys: blocked.keys.join(", ") });
    case "local_refspec":
      return t("git.fetch_local_refspec", { key: blocked.key });
  }
};

export const FetchNotice = ({ fetch }: { fetch: FetchState }) => {
  const t = use_t();
  const { blocked, error } = fetch;
  if (blocked && blocked.kind !== "agent_running") {
    return <GitNotice icon={<CircleSlashIcon size={16} />} title={t("git.autofetch_off")} detail={block_detail(t, blocked)} />;
  }
  if (!error || error.kind === "offline") {
    return null;
  }
  const icon = <CloudAlertIcon size={16} />;
  const host = error.host ?? error.remote;
  const command = error.command ?? undefined;
  switch (error.kind) {
    case "auth_required":
      return <GitNotice icon={icon} title={t("git.fetch_auth", { host })} command={command} command_tip={t("git.fetch_auth_tip")} />;
    case "ssh_key_rejected":
      return <GitNotice icon={icon} title={t("git.fetch_ssh", { host })} command={command} />;
    case "ssh_host_unknown":
      return <GitNotice icon={icon} title={t("git.fetch_ssh_host", { host })} command={command} />;
    case "remote_not_found":
      return <GitNotice icon={icon} title={t("git.fetch_not_found", { remote: error.remote })} />;
    case "error":
      return <GitNotice icon={icon} title={t("git.fetch_failed")} detail={error.detail} mono />;
  }
};

import type { ApprovalRequest } from "../../../shared/approval.ts";
import { Collapsible } from "../../components/Collapsible.tsx";
import { use_t } from "../../i18n/index.ts";
import { ApprovalEnv } from "./ApprovalEnv.tsx";
import { DiffView } from "./DiffView.tsx";

const Command = ({ text }: { text: string }) => <pre className="approval-command inset-surface">{text}</pre>;

export const ApprovalDetail = ({ request }: { request: ApprovalRequest }) => {
  const t = use_t();
  switch (request.kind) {
    case "command":
      return (
        <>
          <Command text={request.command} />
          <div className="approval-meta">
            <span className="tool-body-mono">{request.cwd}</span>
            {request.background && <span>{t("approval.background")}</span>}
          </div>
          {request.overseer && <div className="approval-reason">{request.overseer.reason}</div>}
        </>
      );
    case "write":
      return (
        <>
          <div className="approval-meta">
            <span className="tool-body-mono">{request.path}</span>
            {request.created && <span>{t("tools.created_file")}</span>}
            <span className="tool-stat-add">+{request.added}</span>
            <span className="tool-stat-remove">-{request.removed}</span>
          </div>
          <DiffView lines={request.diff} />
        </>
      );
    case "mcp":
      return (
        <>
          <div className="approval-meta">
            <span>{request.server}</span>
            <span className="tool-body-mono">{request.tool}</span>
            <span className="approval-risk" data-tier={request.tier}>
              {t(`approval.risk_${request.tier}`)}
            </span>
          </div>
          {request.args_preview && <Command text={request.args_preview} />}
          {request.scope && <div className="approval-reason">{request.scope}</div>}
        </>
      );
    case "mcp_server":
      return (
        <>
          {request.replaces && <div className="approval-warning">{t("approval.mcp_replaces", { x: request.name })}</div>}
          <Command text={[request.command, ...request.args].join(" ")} />
          <div className="approval-meta">
            <span className="tool-body-mono">{request.cwd}</span>
          </div>
          <ApprovalEnv env={request.env} />
        </>
      );
    case "skill_install":
      return (
        <>
          <div className="approval-skill">
            <span className="approval-skill-name">{request.name}</span>
            <span className="approval-reason">{request.description}</span>
          </div>
          <div className="approval-meta">
            <span className="tool-body-mono">{request.source}</span>
          </div>
          {request.replaces !== null && <div className="approval-warning">{t("approval.skill_replaces", { x: request.replaces })}</div>}
          {request.files.length > 0 && <Command text={request.files.join("\n")} />}
          <Collapsible header={t("approval.skill_content")}>
            <pre className="approval-command approval-content inset-surface">{request.content}</pre>
          </Collapsible>
        </>
      );
    case "memory":
      return <div className="tool-body-quote">{request.text}</div>;
    case "browser_vision":
      return (
        <div className="approval-meta">
          <span>{t("approval.browser_vision_target")}</span>
          <span className="tool-body-mono">{request.url}</span>
        </div>
      );
  }
};

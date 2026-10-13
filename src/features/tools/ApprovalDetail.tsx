import type { ApprovalRequest } from "../../../shared/approval.ts";
import { shell_name } from "../../../shared/tool-view.ts";
import { Collapsible } from "../../components/Collapsible.tsx";
import { use_t } from "../../i18n/index.ts";
import { ApprovalEnv } from "./ApprovalEnv.tsx";
import { EditCard } from "./bodies-files.tsx";

const Command = ({ text }: { text: string }) => <pre className="approval-command inset-surface">{text}</pre>;

const PreviewText = ({ text, prompt = "" }: { text: string; prompt?: string }) => (
  <div className="command-card-command">
    <pre className="command-card-text approval-preview-text">
      {prompt && <span className="command-card-prompt">{prompt}</span>}
      {text}
    </pre>
  </div>
);

const McpArgs = ({ args, scope }: { args: string; scope: string | null }) => (
  <div className="command-card">
    {args && <PreviewText text={args} />}
    {scope && (
      <div className="command-card-footer">
        <span className="command-card-lead">{scope}</span>
      </div>
    )}
  </div>
);

export const ApprovalDetail = ({ request }: { request: ApprovalRequest }) => {
  const t = use_t();
  switch (request.kind) {
    case "command":
      return (
        <div className="command-card">
          <div className="command-card-shell">{shell_name}</div>
          <PreviewText text={request.command} prompt="$ " />
          <div className="command-card-footer">
            <span className="command-card-lead">{request.cwd}</span>
            {request.background && <span>{t("approval.background")}</span>}
          </div>
        </div>
      );
    case "write":
      return <EditCard {...request} />;
    case "mcp":
      return <McpArgs args={request.args_preview} scope={request.scope} />;
    case "mcp_server":
      return (
        <>
          {request.replaces && <div className="approval-warning">{t("approval.mcp_replaces", { x: request.name })}</div>}
          <Command text={[request.command, ...request.args].join(" ")} />
          <div className="approval-meta">
            <span className="tool-body-path">{request.cwd}</span>
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
    case "agent_message":
      return (
        <>
          {request.about && (
            <div className="approval-meta">
              <span className="approval-reason">{t("approval.agent_about", { x: request.about })}</span>
            </div>
          )}
          <pre className="approval-command approval-content inset-surface">{request.text}</pre>
        </>
      );
  }
};

export const ApprovalHead = ({ request, actor }: { request: ApprovalRequest; actor: string }) => {
  const t = use_t();
  return (
    <>
      {actor && (
        <>
          <span className="question-actor">{actor}</span>
          <span>{t("approval.agent_requests")}</span>
        </>
      )}
      {request.kind === "mcp" && (
        <>
          <span>{request.server}</span>
          <span className="tool-body-mono">{request.tool}</span>
          <span className="approval-risk" data-tier={request.tier}>
            {t(`approval.risk_${request.tier}`)}
          </span>
        </>
      )}
    </>
  );
};

import type { ApprovalRequest } from "../../../shared/approval.ts";
import { CodeBlock } from "../../components/MarkdownCode.tsx";
import { use_t } from "../../i18n/index.ts";
import { split_workflow_approval } from "./workflow-model.ts";

type AgentMessage = Extract<ApprovalRequest, { kind: "agent_message" }>;

export const WorkflowApproval = ({ request }: { request: AgentMessage }) => {
  const t = use_t();
  const { script, args } = split_workflow_approval(request.text);
  return (
    <div className="workflow-approval">
      {request.about && (
        <div className="approval-meta">
          <span className="approval-reason">{t("approval.agent_about", { x: request.about })}</span>
        </div>
      )}
      <CodeBlock language="javascript" code={script} />
      {args !== null && <CodeBlock language="json" code={args} />}
    </div>
  );
};

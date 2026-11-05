import type { ApprovalRequest } from "../../../shared/approval.ts";
import { MonitorIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./computer.css";

type ComputerApprovalProps = { request: Extract<ApprovalRequest, { kind: "computer_use" }> };

export const ComputerApproval = ({ request }: ComputerApprovalProps) => {
  const t = use_t();
  return (
    <div className="computer-approval">
      <div className="computer-approval-head">
        <MonitorIcon />
        <span>{t("approval.computer_display", { x: request.display, w: request.real_width, h: request.real_height })}</span>
      </div>
      <p className="computer-approval-line">{t("approval.computer_screens")}</p>
      <p className="computer-approval-line">{t("approval.computer_confirm")}</p>
    </div>
  );
};

import type { ReactNode } from "react";
import { CopyButton } from "../../../../components/MarkdownCopy.tsx";
import { Tooltip } from "../../../../components/Tooltip.tsx";
import { use_t } from "../../../../i18n/index.ts";
import type { NoticeText } from "./git-notices.ts";
import "./ActionNotice.css";

export const ActionNotice = ({ notice, action }: { notice: NoticeText; action?: ReactNode }) => {
  const t = use_t();
  return (
    <div className="action-notice" data-quiet={notice.quiet === true} role={notice.quiet ? "status" : "alert"}>
      <span className="action-notice-title">{notice.title}</span>
      {notice.detail && <span className="action-notice-detail">{notice.detail}</span>}
      {notice.command && (
        <span className="action-notice-command">
          <Tooltip label={notice.command_tip ?? notice.command} placement="bottom-start">
            <code>{notice.command}</code>
          </Tooltip>
          <CopyButton text={notice.command} label={t("git.copy_command")} />
        </span>
      )}
      {action && <span className="action-notice-action">{action}</span>}
    </div>
  );
};

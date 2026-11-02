import { DotSpinner } from "../../components/DotSpinner.tsx";
import { use_t } from "../../i18n/index.ts";
import type { ActivityStatus } from "./activity.ts";

export const StatusMark = ({ status }: { status: ActivityStatus }) => {
  const t = use_t();
  const shown = {
    waiting: { label: t("sidebar.waiting"), mark: <span className="wait-dot" /> },
    running: { label: t("sidebar.working"), mark: <DotSpinner /> },
    unread: { label: t("sidebar.unread"), mark: <span className="chat-row-unread" /> },
  };
  return (
    <span key={status} className="chat-row-status" role="status" aria-label={shown[status].label}>
      {shown[status].mark}
    </span>
  );
};

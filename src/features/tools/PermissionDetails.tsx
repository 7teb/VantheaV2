import { use_t } from "../../i18n/index.ts";
import type { PermissionCheck } from "../../../shared/approval.ts";

export const PermissionDetails = ({ checks }: { checks: PermissionCheck[] }) => {
  const t = use_t();
  if (!checks.length) return null;
  return (
    <details className="tool-permission">
      <summary>{t("tools.permission_title")}</summary>
      <ol>
        {checks.map((check, index) => (
          <li key={index}>
            <span>{t("tools.permission_source_" + check.source as Parameters<typeof t>[0])} · {t("tools.permission_action_" + check.action as Parameters<typeof t>[0])}</span>
            <div>{check.reason}</div>
            <div className="tool-body-mono" title={check.authorization_hash}>{check.cwd}</div>
          </li>
        ))}
      </ol>
    </details>
  );
};

import { useState } from "react";
import { IconButton } from "../../components/Button.tsx";
import { EyeIcon, EyeOffIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";

const masked_value = "•".repeat(10);

export const ApprovalEnv = ({ env }: { env: Record<string, string> }) => {
  const t = use_t();
  const [revealed, set_revealed] = useState(false);
  const entries = Object.entries(env);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="approval-env">
      <div className="approval-env-head">
        <span>{t("approval.env_label", { n: entries.length })}</span>
        <IconButton size="sm" label={revealed ? t("approval.env_hide") : t("approval.env_show")} active={revealed} onClick={() => set_revealed(!revealed)}>
          {revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
        </IconButton>
      </div>
      <dl className="approval-env-list inset-surface">
        {entries.map(([key, value]) => (
          <div key={key} className="approval-env-row">
            <dt>{key}</dt>
            <dd data-masked={!revealed}>{revealed ? value : masked_value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

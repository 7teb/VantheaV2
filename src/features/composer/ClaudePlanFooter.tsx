import type { ClaudeStatus } from "../../../shared/claude.ts";
import { ClaudeIcon } from "../../components/icons.tsx";
import { use_t, type MessageKey } from "../../i18n/index.ts";
import { claude_store } from "../../state/claude.ts";
import { open_settings } from "../../state/ui.ts";
import { use_store } from "../../state/use-store.ts";

const status_keys: Record<ClaudeStatus, MessageKey> = {
  unknown: "billing.using_claude_plan",
  signed_in: "billing.using_claude_plan",
  signed_out: "billing.claude_not_signed_in",
  other_login: "billing.claude_not_signed_in",
  missing: "billing.claude_missing",
  error: "billing.claude_error",
};

export const ClaudePlanFooter = ({ on_close }: { on_close: () => void }) => {
  const t = use_t();
  const status = use_store(claude_store, (account) => account?.status ?? "unknown");
  const act = () => {
    on_close();
    open_settings("general");
  };
  return (
    <div className="model-menu-plan">
      <span className="model-menu-plan-label">
        <ClaudeIcon size={14} />
        <span className="model-menu-plan-text">{t(status_keys[status])}</span>
      </span>
      <button type="button" role="menuitem" tabIndex={-1} className="model-menu-plan-action" onClick={act}>
        {t("billing.open_settings")}
      </button>
    </div>
  );
};

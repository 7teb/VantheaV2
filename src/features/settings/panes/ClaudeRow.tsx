import { useEffect, useRef } from "react";
import type { ClaudeAccount, ClaudeStatus } from "../../../../shared/claude.ts";
import { Button } from "../../../components/Button.tsx";
import { ClaudeIcon } from "../../../components/icons.tsx";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import type { Translate } from "../../../i18n/translate.ts";
import { claude_store, refresh_claude } from "../../../state/claude.ts";
import { run_in_terminal } from "../../../state/terminal.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsRow } from "../SettingsLayout.tsx";

const unconfirmed: ReadonlySet<ClaudeStatus> = new Set(["unknown", "signed_out", "other_login"]);

const account_label = (t: Translate, account: ClaudeAccount): string =>
  account.status === "signed_in" && account.email ? account.email : t("billing.claude_login");

const account_hint = (t: Translate, account: ClaudeAccount): string | undefined => {
  switch (account.status) {
    case "signed_in":
      return account.subscription || t("billing.claude_signed_in");
    case "signed_out":
      return t("billing.claude_signed_out");
    case "other_login":
      return t("billing.claude_other_login");
    case "missing":
      return t("billing.claude_missing");
    case "unknown":
    case "error":
      return undefined;
  }
};

const error_text = (t: Translate, account: ClaudeAccount): string | null => {
  if (account.status !== "error") {
    return null;
  }
  const line = t("billing.claude_error");
  return account.detail ? `${line}: ${account.detail}` : line;
};

const AccountControls = ({ account }: { account: ClaudeAccount }) => {
  const t = use_t();
  switch (account.status) {
    case "signed_out":
    case "other_login":
      return (
        <>
          <Button variant="ghost" onClick={() => void refresh_claude()}>
            {t("billing.claude_check")}
          </Button>
          <Button icon={<ClaudeIcon size={16} />} onClick={() => run_in_terminal(account.login_command)}>
            {t("billing.claude_sign_in")}
          </Button>
        </>
      );
    case "signed_in":
    case "unknown":
    case "error":
      return <Button onClick={() => void refresh_claude()}>{t("billing.claude_check")}</Button>;
    case "missing":
      return null;
  }
};

export const ClaudeRow = () => {
  const t = use_t();
  const account = use_store(claude_store, (state) => state);
  const status = account?.status ?? null;
  const asked = useRef(false);

  useEffect(() => {
    if (status === null || !unconfirmed.has(status) || asked.current) {
      return;
    }
    asked.current = true;
    void refresh_claude();
  }, [status]);

  if (!account) {
    return (
      <div className="settings-row" aria-hidden="true">
        <Skeleton width={160} height={13} radius={5} />
        <Skeleton width={120} height={32} radius={9} />
      </div>
    );
  }

  return (
    <SettingsRow label={account_label(t, account)} hint={account_hint(t, account)} error={error_text(t, account)}>
      <AccountControls account={account} />
    </SettingsRow>
  );
};

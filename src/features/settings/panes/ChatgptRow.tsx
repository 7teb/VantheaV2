import { chatgpt_usage_url, type ChatgptAccount } from "../../../../shared/chatgpt.ts";
import { Button } from "../../../components/Button.tsx";
import { ExternalLinkIcon, OpenAiIcon } from "../../../components/icons.tsx";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { WorkingLetters } from "../../../components/WorkingLetters.tsx";
import { use_t } from "../../../i18n/index.ts";
import type { Translate } from "../../../i18n/translate.ts";
import { open_external } from "../../../state/chat-actions.ts";
import { cancel_sign_in, chatgpt_store, sign_in, sign_out } from "../../../state/chatgpt.ts";
import { use_store } from "../../../state/use-store.ts";
import { SettingsRow } from "../SettingsLayout.tsx";
import "./ChatgptRow.css";

const error_text = (t: Translate, account: ChatgptAccount): string | null =>
  account.error ? t(`billing.error_${account.error.code}`, { email: account.error.detail }) : null;

const ContinueButton = ({ label, fresh }: { label: string; fresh: boolean }) => (
  <Button className="chatgpt-button" icon={<OpenAiIcon size={16} />} onClick={() => void sign_in({ fresh, consent: false })}>
    {label}
  </Button>
);

const OtherAccountButton = ({ label }: { label: string }) => (
  <Button variant="ghost" onClick={() => void sign_in({ fresh: true, consent: false })}>
    {label}
  </Button>
);

const SignOutButton = ({ label, variant }: { label: string; variant: "secondary" | "ghost" }) => (
  <Button variant={variant} onClick={() => void sign_out()}>
    {label}
  </Button>
);

const AccountControls = ({ account }: { account: ChatgptAccount }) => {
  const t = use_t();
  const remembered = account.email !== null;
  switch (account.status) {
    case "signing_in":
      return (
        <>
          <span className="chatgpt-opening is-working">
            <WorkingLetters text={t("billing.opening")} />
          </span>
          <Button onClick={() => void cancel_sign_in()}>{t("billing.cancel")}</Button>
        </>
      );
    case "signed_in":
      return account.plan_enabled ? (
        <>
          <Button
            variant="ghost"
            icon_end={<ExternalLinkIcon />}
            aria-label={t("billing.manage_usage_aria")}
            onClick={() => open_external(chatgpt_usage_url)}
          >
            {t("billing.manage_usage")}
          </Button>
          <SignOutButton label={t("billing.sign_out")} variant="secondary" />
        </>
      ) : (
        <>
          <SignOutButton label={t("billing.sign_out")} variant="ghost" />
          <Button onClick={() => void sign_in({ fresh: false, consent: true })}>{t("billing.enable_plan")}</Button>
        </>
      );
    case "expired":
      return (
        <>
          <OtherAccountButton label={t("billing.other_account")} />
          <Button onClick={() => void sign_in({ fresh: false, consent: false })}>{t("billing.reconnect")}</Button>
        </>
      );
    case "signed_out":
      return remembered ? (
        <>
          <OtherAccountButton label={t("billing.other_account")} />
          <ContinueButton label={t("billing.continue")} fresh={false} />
        </>
      ) : (
        <ContinueButton label={t("billing.continue")} fresh />
      );
  }
};

const account_label = (t: Translate, account: ChatgptAccount): string => {
  if (account.status === "signed_in" && account.plan_enabled) {
    return account.name ?? account.email ?? t("billing.mode_plan");
  }
  if (account.status === "signed_out" || account.status === "signing_in") {
    return account.email ?? t("billing.card_title");
  }
  return account.email ?? account.name ?? t("billing.mode_plan");
};

const account_hint = (t: Translate, account: ChatgptAccount): string | undefined => {
  if (account.status === "signed_in") {
    return t(account.plan_enabled ? "billing.connected" : "billing.plan_disabled");
  }
  return account.status === "signed_out" && account.email === null ? t("billing.card_text") : undefined;
};

export const ChatgptRow = () => {
  const t = use_t();
  const account = use_store(chatgpt_store, (state) => state);

  if (!account) {
    return (
      <div className="settings-row" aria-hidden="true">
        <Skeleton width={160} height={13} radius={5} />
        <Skeleton width={170} height={32} radius={9} />
      </div>
    );
  }

  return (
    <SettingsRow label={account_label(t, account)} hint={account_hint(t, account)} error={error_text(t, account)}>
      <AccountControls account={account} />
    </SettingsRow>
  );
};

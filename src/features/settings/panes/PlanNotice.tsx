import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { OpenAiIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { chatgpt_store, dismiss_notice } from "../../../state/chatgpt.ts";
import { settings_store } from "../../../state/settings.ts";
import { use_store } from "../../../state/use-store.ts";
import "./PlanNotice.css";

export const PlanNotice = () => {
  const t = use_t();
  const unseen = use_store(chatgpt_store, (account) => account?.status === "signed_in" && account.plan_enabled && !account.notice_seen);
  const plan_billing = use_store(settings_store, (view) => view?.billing === "chatgpt");
  const close = () => void dismiss_notice();

  return (
    <Dialog open={unseen && plan_billing} on_close={close} label={t("billing.notice_title")} className="confirm-dialog">
      <OpenAiIcon size={28} className="plan-notice-logo" />
      <h2 className="confirm-title">{t("billing.notice_title")}</h2>
      <p className="confirm-detail">{t("billing.notice_text")}</p>
      <div className="confirm-actions">
        <Button onClick={close}>{t("billing.notice_ok")}</Button>
      </div>
    </Dialog>
  );
};

import { setTimeout as delay } from "node:timers/promises";
import { shell } from "electron";
import type { BillingMode } from "../../shared/settings.ts";
import { access_token, account_models, chatgpt_account, init_chatgpt, refresh_account_models, renewed_token, shutdown_chatgpt } from "../chatgpt/service.ts";
import { emit } from "../ipc/handle.ts";
import { set_plan_source } from "../model/plan/source.ts";
import { get_internal_secret, get_settings, on_settings_changed, secret_storage_available, set_internal_secret } from "../settings/store.ts";
import { error_text } from "../storage/coerce.ts";
import { storage_paths } from "../storage/paths.ts";
import { billing_catalog } from "./catalog.ts";

let billing_seen: BillingMode | null = null;

const publish = () => {
  billing_catalog()
    .then((catalog) => emit("models:changed", catalog))
    .catch((error) => console.error("[billing] publishing the model catalog after a billing or account change failed:", error_text(error)));
};

const reload_account_models = (reason: string) => {
  refresh_account_models().catch((error) => console.error(`[billing] reloading the ChatGPT model list ${reason} failed:`, error_text(error)));
};

const billing_changed = (billing: BillingMode) => {
  if (billing === billing_seen) {
    return;
  }
  billing_seen = billing;
  if (billing === "chatgpt" && chatgpt_account().status === "signed_in") {
    reload_account_models("after the switch to the ChatGPT plan");
  }
  publish();
};

export const wire_billing = () => {
  set_plan_source({
    billing: () => get_settings().billing,
    access_token,
    renewed_token,
    model_rejected: (model_id) => reload_account_models(`after the plan rejected ${model_id}`),
    account_models,
  });
  on_settings_changed((view) => billing_changed(view.billing));
};

export const init_billing = async (): Promise<void> => {
  billing_seen = get_settings().billing;
  await init_chatgpt({
    fetch: (url, init) => fetch(url, init),
    now: Date.now,
    sleep: (ms) => delay(ms),
    open_url: (url) => shell.openExternal(url),
    secret: {
      available: secret_storage_available,
      read: () => get_internal_secret("chatgpt_session"),
      write: (plain) => set_internal_secret("chatgpt_session", plain),
    },
    file: storage_paths().chatgpt,
    language: () => get_settings().language,
    changed: (account) => emit("chatgpt:changed", account),
    models_changed: publish,
  });
};

export const shutdown_billing = () => {
  shutdown_chatgpt();
};

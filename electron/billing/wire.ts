import { setTimeout as delay } from "node:timers/promises";
import { shell } from "electron";
import type { BillingMode, ClaudeBillingMode } from "../../shared/settings.ts";
import { access_token, account_models, chatgpt_account, init_chatgpt, refresh_account_models, renewed_token, shutdown_chatgpt } from "../chatgpt/service.ts";
import { claude_env } from "../claude/env.ts";
import { claude_executable } from "../claude/executable.ts";
import { create_claude_runtime } from "../claude/query.ts";
import { set_claude_runtime } from "../claude/runtime.ts";
import { init_claude, refresh_claude_account, shutdown_claude } from "../claude/service.ts";
import { emit } from "../ipc/handle.ts";
import { set_plan_source } from "../model/plan/source.ts";
import { get_internal_secret, get_settings, on_settings_changed, secret_storage_available, set_internal_secret } from "../settings/store.ts";
import { error_text } from "../storage/coerce.ts";
import { storage_paths } from "../storage/paths.ts";
import { billing_catalog } from "./catalog.ts";

let billing_seen: BillingMode | null = null;

let claude_billing_seen: ClaudeBillingMode | null = null;

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

const refresh_claude = (reason: string) => {
  refresh_claude_account().catch((error) => console.error(`[billing] reading the Claude Code login state ${reason} failed:`, error_text(error)));
};

const claude_billing_changed = (billing: ClaudeBillingMode) => {
  if (billing === claude_billing_seen) {
    return;
  }
  claude_billing_seen = billing;
  if (billing === "claude") {
    refresh_claude("after the switch to the Claude plan");
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
  set_claude_runtime(
    create_claude_runtime({
      executable: claude_executable,
      env: () => claude_env(),
      auth_failed: () => refresh_claude("after Claude Code refused the login"),
    }),
  );
  on_settings_changed((view) => billing_changed(view.billing));
  on_settings_changed((view) => claude_billing_changed(view.claude_billing));
};

export const init_billing = async (): Promise<void> => {
  billing_seen = get_settings().billing;
  claude_billing_seen = get_settings().claude_billing;
  init_claude({ changed: (account) => emit("claude:changed", account) });
  if (claude_billing_seen === "claude") {
    refresh_claude("at startup");
  }
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
  shutdown_claude();
};

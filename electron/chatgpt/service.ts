import type { AccountModel, ChatgptAccount, ChatgptSignIn } from "../../shared/chatgpt.ts";
import type { Language } from "../../shared/settings.ts";
import { error_text } from "../storage/coerce.ts";
import { load_account_models } from "./account-models.ts";
import { create_key_set } from "./id-token.ts";
import { current_access_token, renew_access_token } from "./session.ts";
import { begin_sign_in, cancel_attempt } from "./sign-in.ts";
import { sign_out_session } from "./sign-out.ts";
import { account_view, announce, close_attempt, save_plain, settle_refresh, type ChatgptState } from "./state.ts";
import { read_plain, read_session, type SessionSecret } from "./store.ts";

export type ChatgptDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  open_url: (url: string) => Promise<void>;
  secret: SessionSecret;
  file: string;
  language: () => Language;
  changed: (account: ChatgptAccount) => void;
  models_changed: () => void;
};

let state: ChatgptState | null = null;

export const refresh_account_models = async (): Promise<void> => {
  const current = state;
  if (!current) {
    return;
  }
  try {
    if (await load_account_models(current)) {
      current.deps.models_changed();
    }
  } catch (error) {
    console.error("[chatgpt] loading the ChatGPT model list failed:", error_text(error));
  }
};

export const settle_chatgpt = (): Promise<void> => (state ? settle_refresh(state, "the quit") : Promise.resolve());

export const shutdown_chatgpt = () => {
  if (state) {
    close_attempt(state);
  }
  state = null;
};

export const init_chatgpt = async (deps: ChatgptDeps): Promise<void> => {
  shutdown_chatgpt();
  const session = read_session(deps.secret);
  const plain = await read_plain(deps.file);
  state = { deps, session, plain, error: null, attempt: null, refreshing: null, keys: create_key_set(deps.fetch) };
  if (session.account?.tokens) {
    void refresh_account_models();
  }
};

export const chatgpt_account = (): ChatgptAccount => account_view(state);

export const start_sign_in = (request: ChatgptSignIn): Promise<ChatgptAccount> =>
  state ? begin_sign_in(state, request) : Promise.reject(new Error("the ChatGPT account service is not initialized"));

export const cancel_sign_in = (): ChatgptAccount => (state ? cancel_attempt(state) : account_view(null));

export const sign_out = async (): Promise<ChatgptAccount> => (state ? sign_out_session(state) : account_view(null));

export const dismiss_notice = async (): Promise<ChatgptAccount> => {
  const current = state;
  if (!current) {
    return account_view(null);
  }
  await save_plain(current, { ...current.plain, notice_seen: true });
  announce(current);
  return account_view(current);
};

export const access_token = (): Promise<string> => current_access_token(state);

export const renewed_token = (rejected: string): Promise<string> => renew_access_token(state, rejected);

export const account_models = (): readonly AccountModel[] | null => state?.plain.models ?? null;

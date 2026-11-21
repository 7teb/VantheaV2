import type { ChatgptAccount, ChatgptErrorCode } from "../../shared/chatgpt.ts";
import { error_text } from "../storage/coerce.ts";
import type { CallbackServer } from "./callback-server.ts";
import { plan_scope } from "./endpoints.ts";
import type { KeySet } from "./id-token.ts";
import type { ChatgptDeps } from "./service.ts";
import { write_plain, type PlainState, type SessionRecord, type StoredTokens } from "./store.ts";

export type SignInFlow = "returning" | "pending" | "register";

export type Attempt = { server: CallbackServer; flow: SignInFlow; client_id: string; nonce: string; verifier: string };

export type Failure = { code: ChatgptErrorCode; detail: string };

export type ChatgptState = {
  deps: ChatgptDeps;
  session: SessionRecord;
  plain: PlainState;
  error: Failure | null;
  attempt: Attempt | null;
  refreshing: Promise<StoredTokens> | null;
  keys: KeySet;
};

const signed_out_view: ChatgptAccount = { status: "signed_out", email: null, name: null, plan_enabled: false, notice_seen: false, error: null };

export const account_view = (state: ChatgptState | null): ChatgptAccount => {
  if (!state) {
    return signed_out_view;
  }
  const account = state.session.account;
  const tokens = account?.tokens ?? null;
  const status = state.attempt ? "signing_in" : tokens ? "signed_in" : account?.expired ? "expired" : "signed_out";
  return {
    status,
    email: account?.email ?? null,
    name: account?.name ?? null,
    plan_enabled: tokens?.scopes.includes(plan_scope) ?? false,
    notice_seen: state.plain.notice_seen,
    error: state.error,
  };
};

export const announce = (state: ChatgptState) => {
  state.deps.changed(account_view(state));
};

export const settle_refresh = async (state: ChatgptState, before: string) => {
  while (state.refreshing) {
    await state.refreshing.catch((error: unknown) => console.error(`[chatgpt] a token renewal before ${before} failed:`, error_text(error)));
  }
};

export const close_attempt = (state: ChatgptState) => {
  const attempt = state.attempt;
  if (!attempt) {
    return;
  }
  state.attempt = null;
  attempt.server.close();
};

export const save_plain = async (state: ChatgptState, plain: PlainState) => {
  state.plain = plain;
  try {
    await write_plain(state.deps.file, plain);
  } catch (error) {
    console.error(`[chatgpt] writing ${state.deps.file} failed:`, error_text(error));
  }
};

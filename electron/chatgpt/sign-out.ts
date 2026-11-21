import type { ChatgptAccount } from "../../shared/chatgpt.ts";
import { retry_backoff_ms } from "../model/errors.ts";
import { error_text } from "../storage/coerce.ts";
import { account_view, announce, close_attempt, save_plain, settle_refresh, type ChatgptState, type Failure } from "./state.ts";
import { write_session } from "./store.ts";
import { revoke_token } from "./token-endpoint.ts";

const revoke = async (state: ChatgptState, client_id: string, refresh_token: string): Promise<Failure | null> => {
  let reply = await revoke_token(state.deps.fetch, { client_id, refresh_token });
  if (reply.kind === "unavailable") {
    await state.deps.sleep(retry_backoff_ms[0]);
    reply = await revoke_token(state.deps.fetch, { client_id, refresh_token });
  }
  if (reply.kind === "revoked") {
    return null;
  }
  console.error(`[chatgpt] ChatGPT did not confirm the token revocation: ${reply.detail}`);
  return { code: "revocation_unconfirmed", detail: reply.detail };
};

export const sign_out_session = async (state: ChatgptState): Promise<ChatgptAccount> => {
  close_attempt(state);
  await settle_refresh(state, "the sign-out");
  const account = state.session.account;
  const tokens = account?.tokens ?? null;
  state.session = { ...state.session, account: account ? { ...account, tokens: null, expired: false } : null };
  const unconfirmed = account && tokens ? await revoke(state, account.client_id, tokens.refresh_token) : null;
  let failure = unconfirmed;
  try {
    await write_session(state.deps.secret, state.session);
  } catch (error) {
    console.error("[chatgpt] clearing the stored ChatGPT tokens failed:", error_text(error));
    failure = { code: "storage_unavailable", detail: error_text(error) };
  }
  await save_plain(state, { ...state.plain, models: null });
  state.error = failure;
  announce(state);
  state.deps.models_changed();
  return account_view(state);
};

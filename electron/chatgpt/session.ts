import { ModelError } from "../model/errors.ts";
import { error_text } from "../storage/coerce.ts";
import { plan_scope } from "./endpoints.ts";
import { SigningKeysUnavailable, verify_id_token } from "./id-token.ts";
import { announce, type ChatgptState } from "./state.ts";
import { write_session, type StoredAccount, type StoredTokens } from "./store.ts";
import { refresh_grant } from "./token-endpoint.ts";

const not_signed_in = "Not signed in to ChatGPT. Sign in under Settings > General.";

const expired_text = "The ChatGPT sign-in has expired. Sign in again under Settings > General.";

const terminal_codes = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

const plan_tokens = (from: ChatgptState | null): [ChatgptState, StoredTokens] => {
  const tokens = from?.session.account?.tokens;
  if (!from || !tokens) {
    throw new ModelError("plan_auth", not_signed_in);
  }
  if (!tokens.scopes.includes(plan_scope)) {
    throw new ModelError("plan_auth", "This ChatGPT sign-in does not allow plan usage. Enable it under Settings > General.");
  }
  return [from, tokens];
};

const store_session = async (state: ChatgptState, what: string) => {
  try {
    await write_session(state.deps.secret, state.session);
  } catch (error) {
    console.error(`[chatgpt] storing ${what} failed:`, error_text(error));
  }
};

const expire = async (state: ChatgptState, account: StoredAccount, reason: string): Promise<never> => {
  console.error(`[chatgpt] the ChatGPT sign-in ended (${reason}), a new sign-in is required`);
  state.session = { ...state.session, account: { ...account, tokens: null, expired: true } };
  await store_session(state, "the expired ChatGPT sign-in");
  announce(state);
  state.deps.models_changed();
  throw new ModelError("plan_auth", expired_text);
};

const renewed_identity = async (state: ChatgptState, account: StoredAccount, id_token: string | null) => {
  const previous = { id_token: account.tokens?.id_token ?? "", email: account.email, name: account.name };
  if (!id_token) {
    return previous;
  }
  try {
    const claims = await verify_id_token(id_token, { client_id: account.client_id, nonce: null, now: state.deps.now() }, state.keys);
    if (claims.sub !== account.subject) {
      throw new Error("the renewed ID token names another account");
    }
    return { id_token, email: claims.email ?? account.email, name: claims.name ?? account.name };
  } catch (error) {
    if (error instanceof SigningKeysUnavailable) {
      console.error(`[chatgpt] the renewed ID token could not be checked, keeping the renewed tokens with the previous ID token: ${error.message}`);
      return previous;
    }
    return expire(state, account, error_text(error));
  }
};

const run_refresh = async (state: ChatgptState): Promise<StoredTokens> => {
  const account = state.session.account;
  const tokens = account?.tokens;
  if (!account || !tokens) {
    throw new ModelError("plan_auth", not_signed_in);
  }
  const reply = await refresh_grant(state.deps.fetch, { client_id: account.client_id, refresh_token: tokens.refresh_token });
  if (state.session.account !== account) {
    throw new ModelError("plan_auth", "The ChatGPT sign-in changed while its token was being renewed. Try again.");
  }
  if (reply.kind === "unavailable") {
    throw new ModelError("provider_unavailable", `Renewing the ChatGPT sign-in failed: ${reply.detail}`, reply.status);
  }
  if (reply.kind === "malformed") {
    throw new ModelError("plan_auth", `Renewing the ChatGPT sign-in failed: ${reply.detail}`);
  }
  if (reply.kind === "oauth_error") {
    if (terminal_codes.has(reply.code)) {
      return expire(state, account, `${reply.code}: ${reply.description}`);
    }
    const code = reply.code || `HTTP ${reply.status}`;
    throw new ModelError("plan_auth", `Renewing the ChatGPT sign-in failed with ${code} (${reply.description}). Sign in again under Settings > General.`, reply.status);
  }
  const fields = reply.fields;
  if (!fields.access_token || fields.expires_in === null) {
    throw new ModelError("plan_auth", "Renewing the ChatGPT sign-in failed: the token endpoint returned no access token or expiry.");
  }
  const identity = await renewed_identity(state, account, fields.id_token);
  const now = state.deps.now();
  const renewed: StoredTokens = {
    access_token: fields.access_token,
    refresh_token: fields.refresh_token ?? tokens.refresh_token,
    id_token: identity.id_token,
    token_type: fields.token_type ?? tokens.token_type,
    scopes: fields.scopes ?? tokens.scopes,
    expires_at: now + fields.expires_in * 1000,
    earliest_refresh_at: fields.earliest_refresh_at,
    saved_at: now,
  };
  const plan_changed = renewed.scopes.includes(plan_scope) !== tokens.scopes.includes(plan_scope);
  state.session = { ...state.session, account: { ...account, email: identity.email, name: identity.name, tokens: renewed } };
  await store_session(state, "the renewed ChatGPT tokens");
  if (plan_changed) {
    announce(state);
  }
  return renewed;
};

const refresh = (state: ChatgptState): Promise<StoredTokens> => {
  state.refreshing ??= run_refresh(state).finally(() => {
    state.refreshing = null;
  });
  return state.refreshing;
};

export const current_access_token = async (from: ChatgptState | null): Promise<string> => {
  const [state, tokens] = plan_tokens(from);
  if (state.refreshing) {
    return (await state.refreshing).access_token;
  }
  if (state.deps.now() < tokens.expires_at) {
    return tokens.access_token;
  }
  return (await refresh(state)).access_token;
};

export const renew_access_token = async (from: ChatgptState | null, rejected: string): Promise<string> => {
  const [state, tokens] = plan_tokens(from);
  if (state.refreshing || tokens.access_token !== rejected) {
    return current_access_token(state);
  }
  if (tokens.earliest_refresh_at !== null && state.deps.now() < tokens.earliest_refresh_at) {
    throw new ModelError("plan_auth", "ChatGPT rejected the access token and the sign-in cannot be renewed yet. Try again later or sign in again under Settings > General.");
  }
  return (await refresh(state)).access_token;
};

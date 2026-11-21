import type { ChatgptAccount, ChatgptErrorCode, ChatgptSignIn } from "../../shared/chatgpt.ts";
import { error_text } from "../storage/coerce.ts";
import { load_account_models } from "./account-models.ts";
import { authorize_url } from "./authorize-url.ts";
import { callback_page } from "./callback-page.ts";
import { start_callback_server, type CallbackServer } from "./callback-server.ts";
import { authorize_endpoint, issuer, registration_client_id } from "./endpoints.ts";
import { verify_id_token, type IdClaims } from "./id-token.ts";
import { code_challenge, random_value } from "./pkce.ts";
import { account_view, announce, close_attempt, save_plain, settle_refresh, type Attempt, type ChatgptState, type Failure, type SignInFlow } from "./state.ts";
import { write_session, type SessionRecord, type StoredAccount, type StoredTokens } from "./store.ts";
import { exchange_code, revoke_token } from "./token-endpoint.ts";

type Issued = { claims: IdClaims; tokens: StoredTokens };

const failure = (code: ChatgptErrorCode, detail = ""): Failure => ({ code, detail });

const persist = async (state: ChatgptState, session: SessionRecord) => {
  await write_session(state.deps.secret, session);
  state.session = session;
};

const abandon = async (state: ChatgptState, client_id: string, refresh_token: string, what = "an unused ChatGPT refresh token") => {
  const reply = await revoke_token(state.deps.fetch, { client_id, refresh_token });
  if (reply.kind !== "revoked") {
    console.error(`[chatgpt] revoking ${what} failed: ${reply.detail}`);
  }
};

const drop_pending = async (state: ChatgptState, client_id: string) => {
  if (state.session.pending_client_id !== client_id) {
    return;
  }
  try {
    await persist(state, { ...state.session, pending_client_id: null });
  } catch (error) {
    console.error("[chatgpt] clearing the pending ChatGPT client id failed:", error_text(error));
  }
};

const release_replaced = async (state: ChatgptState, replaced: StoredAccount | null, client_id: string) => {
  if (!replaced?.tokens || replaced.client_id === client_id) {
    return;
  }
  await abandon(state, replaced.client_id, replaced.tokens.refresh_token, "the refresh token of the replaced ChatGPT sign-in");
};

const decline = async (state: ChatgptState, attempt: Attempt, params: URLSearchParams): Promise<Failure> => {
  const code = params.get("error") ?? "";
  console.error(`[chatgpt] the ChatGPT sign-in ended with ${code}: ${params.get("error_description") ?? ""}`);
  await drop_pending(state, attempt.client_id);
  return failure("declined", code === "access_denied" ? "" : code);
};

const issued_client_id = (attempt: Attempt, params: URLSearchParams): string | Failure => {
  const returned = params.get("client_id");
  if (attempt.flow === "register") {
    return returned && returned !== registration_client_id ? returned : failure("registration_incomplete", "the sign-in callback carried no issued client id");
  }
  return returned === null || returned === attempt.client_id ? attempt.client_id : failure("token_invalid", "the sign-in callback named a different client id");
};

const exchange = async (state: ChatgptState, attempt: Attempt, client_id: string, code: string): Promise<Issued | Failure> => {
  const reply = await exchange_code(state.deps.fetch, { client_id, code, code_verifier: attempt.verifier, redirect_uri: attempt.server.redirect_uri });
  if (reply.kind === "unavailable") {
    return failure("network", reply.detail);
  }
  if (reply.kind === "malformed") {
    return failure("token_invalid", reply.detail);
  }
  if (reply.kind === "oauth_error") {
    console.error(`[chatgpt] the ChatGPT code exchange failed with ${reply.code}: ${reply.description}`);
    if (reply.code !== "invalid_grant") {
      await drop_pending(state, client_id);
    }
    return failure("token_invalid", reply.code || reply.description);
  }
  const fields = reply.fields;
  const { access_token, refresh_token, id_token, token_type, expires_in, scopes } = fields;
  if (!access_token || !refresh_token || !id_token || !token_type || expires_in === null || scopes === null) {
    const missing = Object.entries({ access_token, refresh_token, id_token, token_type, expires_in, scope: scopes }).filter(([, value]) => value === null);
    if (refresh_token) {
      await abandon(state, client_id, refresh_token);
    }
    return failure("token_invalid", `the token response has no ${missing.map(([name]) => name).join(", ")}`);
  }
  let claims: IdClaims;
  try {
    claims = await verify_id_token(id_token, { client_id, nonce: attempt.nonce, now: state.deps.now() }, state.keys);
  } catch (error) {
    console.error("[chatgpt] the ChatGPT ID token was rejected:", error_text(error));
    await abandon(state, client_id, refresh_token);
    return failure("token_invalid", error_text(error));
  }
  const now = state.deps.now();
  const tokens: StoredTokens = { access_token, refresh_token, id_token, token_type, scopes, expires_at: now + expires_in * 1000, earliest_refresh_at: fields.earliest_refresh_at, saved_at: now };
  return { claims, tokens };
};

const complete_sign_in = async (state: ChatgptState, attempt: Attempt, params: URLSearchParams): Promise<Failure | null> => {
  if (params.has("error")) {
    return decline(state, attempt, params);
  }
  const code = params.get("code");
  if (!code) {
    return failure("token_invalid", "the sign-in callback carried no authorization code");
  }
  const client_id = issued_client_id(attempt, params);
  if (typeof client_id !== "string") {
    return client_id;
  }
  if (attempt.flow === "register") {
    try {
      await persist(state, { ...state.session, pending_client_id: client_id });
    } catch (error) {
      console.error("[chatgpt] storing the issued ChatGPT client id failed:", error_text(error));
      return failure("storage_unavailable", error_text(error));
    }
  }
  const issued = await exchange(state, attempt, client_id, code);
  if ("code" in issued) {
    return issued;
  }
  const { claims, tokens } = issued;
  await settle_refresh(state, "the sign-in replaced the stored tokens");
  if (state.attempt !== attempt) {
    await abandon(state, client_id, tokens.refresh_token);
    return failure("cancelled");
  }
  const stored = state.session.account;
  if (attempt.flow === "returning" && stored && stored.subject !== claims.sub) {
    await abandon(state, client_id, tokens.refresh_token);
    return failure("wrong_account", stored.email ?? "");
  }
  const known = stored?.subject === claims.sub ? stored : null;
  const account = { issuer, subject: claims.sub, client_id, email: claims.email ?? known?.email ?? null, name: claims.name ?? known?.name ?? null, expired: false, tokens };
  try {
    await persist(state, { account, pending_client_id: null });
  } catch (error) {
    console.error("[chatgpt] storing the ChatGPT sign-in failed:", error_text(error));
    await abandon(state, client_id, tokens.refresh_token);
    return failure("storage_unavailable", error_text(error));
  }
  await release_replaced(state, stored, client_id);
  await save_plain(state, { ...state.plain, models: null });
  return null;
};

const run_callback = async (state: ChatgptState, attempt: Attempt) => {
  const params = await attempt.server.result;
  if (!params || state.attempt !== attempt) {
    return;
  }
  const outcome = await complete_sign_in(state, attempt, params);
  if (outcome && state.attempt !== attempt) {
    return;
  }
  if (state.attempt === attempt) {
    state.attempt = null;
  }
  state.error = outcome;
  announce(state);
  if (outcome) {
    return;
  }
  try {
    await load_account_models(state);
  } catch (error) {
    console.error("[chatgpt] loading the ChatGPT model list after the sign-in failed:", error_text(error));
  }
  state.deps.models_changed();
};

const redact = (text: string, values: string[]): string => values.reduce((result, value) => result.replaceAll(value, "[redacted]"), text);

export const begin_sign_in = async (state: ChatgptState, request: ChatgptSignIn): Promise<ChatgptAccount> => {
  if (!state.deps.secret.available()) {
    state.error = failure("storage_unavailable", "Electron safeStorage is unavailable, so a ChatGPT sign-in cannot be stored");
    announce(state);
    return account_view(state);
  }
  close_attempt(state);
  const returning = request.fresh ? null : state.session.account;
  const pending = request.fresh ? null : state.session.pending_client_id;
  const flow: SignInFlow = returning ? "returning" : pending ? "pending" : "register";
  const client_id = returning?.client_id ?? pending ?? registration_client_id;
  const oauth_state = random_value();
  const nonce = random_value();
  const verifier = random_value();
  let server: CallbackServer;
  try {
    server = await start_callback_server(oauth_state, (received) => callback_page(state.deps.language(), received));
  } catch (error) {
    console.error("[chatgpt] starting the sign-in callback listener failed:", error_text(error));
    state.error = failure("network", error_text(error));
    announce(state);
    return account_view(state);
  }
  close_attempt(state);
  const attempt: Attempt = { server, flow, client_id, nonce, verifier };
  state.attempt = attempt;
  state.error = null;
  void run_callback(state, attempt).catch((error: unknown) => {
    console.error("[chatgpt] completing the ChatGPT sign-in failed:", error_text(error));
    if (state.attempt === attempt) {
      state.attempt = null;
      state.error = failure("token_invalid", error_text(error));
      announce(state);
    }
  });
  announce(state);
  const challenge = code_challenge(verifier);
  const login_hint = returning?.email ?? null;
  const url = authorize_url({ client_id, host_id: state.plain.host_id, login_hint, redirect_uri: server.redirect_uri, state: oauth_state, nonce, code_challenge: challenge, consent: request.consent });
  try {
    await state.deps.open_url(url);
  } catch (error) {
    const reason = redact(error_text(error), [url, oauth_state, nonce, challenge]);
    console.error("[chatgpt] opening the ChatGPT sign-in page in the system browser failed:", reason);
    if (state.attempt === attempt) {
      close_attempt(state);
      state.error = failure("open_failed", reason);
      announce(state);
    }
    return account_view(state);
  }
  console.log(`[chatgpt] opened the ChatGPT sign-in page at ${authorize_endpoint}`);
  return account_view(state);
};

export const cancel_attempt = (state: ChatgptState): ChatgptAccount => {
  if (state.attempt) {
    close_attempt(state);
    state.error = null;
    announce(state);
  }
  return account_view(state);
};

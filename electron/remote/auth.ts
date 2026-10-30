import type { IncomingMessage } from "node:http";
import { get_internal_secret, set_internal_secret } from "../settings/store.ts";
import { new_session_id, new_token, session_cookie, token_matches, verify_session } from "./session-cookie.ts";

let token = "";

export const renew_token = async (): Promise<string> => {
  const next = new_token();
  await set_internal_secret("remote_token", next);
  token = next;
  return token;
};

export const ensure_token = async (): Promise<string> => {
  token = get_internal_secret("remote_token");
  return token || renew_token();
};

export const current_token = (): string => token;

export const pair = (query_token: string): string | null => (token_matches(token, query_token) ? session_cookie(token, new_session_id()) : null);

export const session_of = (request: IncomingMessage): string | null => verify_session(token, request.headers.cookie ?? "");

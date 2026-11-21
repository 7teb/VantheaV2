import { error_text, is_record } from "../storage/coerce.ts";
import { api_resource, revocation_endpoint, token_endpoint } from "./endpoints.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type TokenFields = {
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  token_type: string | null;
  expires_in: number | null;
  scopes: string[] | null;
  earliest_refresh_at: number | null;
};

type TokenReply =
  | { kind: "tokens"; fields: TokenFields }
  | { kind: "oauth_error"; status: number; code: string; description: string }
  | { kind: "malformed"; detail: string }
  | { kind: "unavailable"; status: number | null; detail: string };

type RevokeReply = { kind: "revoked" } | { kind: "refused"; detail: string } | { kind: "unavailable"; detail: string };

const text_field = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const read_earliest = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 1000;
  }
  if (typeof value === "string") {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  }
  return null;
};

const read_fields = (body: Record<string, unknown>): TokenFields => ({
  access_token: text_field(body.access_token),
  refresh_token: text_field(body.refresh_token),
  id_token: text_field(body.id_token),
  token_type: text_field(body.token_type),
  expires_in: typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null,
  scopes: typeof body.scope === "string" ? body.scope.split(" ").filter((entry) => entry !== "") : null,
  earliest_refresh_at: read_earliest(body.earliest_refresh_at),
});

const parse_body = (raw: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(raw);
    return is_record(value) ? value : null;
  } catch {
    return null;
  }
};

const request_note = (response: Response): string => {
  const id = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
  return id ? ` (request ${id})` : "";
};

const post_form = (fetch: Fetch, url: string, fields: Record<string, string>): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
    redirect: "error",
  });

const token_request = async (fetch: Fetch, fields: Record<string, string>): Promise<TokenReply> => {
  let response: Response;
  let raw: string;
  try {
    response = await post_form(fetch, token_endpoint, fields);
    raw = await response.text();
  } catch (error) {
    return { kind: "unavailable", status: null, detail: `the ChatGPT token endpoint could not be reached: ${error_text(error)}` };
  }
  const body = parse_body(raw);
  const note = request_note(response);
  if (response.status >= 500) {
    const code = text_field(body?.error);
    return { kind: "unavailable", status: response.status, detail: `the ChatGPT token endpoint answered HTTP ${response.status}${code ? ` ${code}` : ""}${note}` };
  }
  if (!response.ok) {
    return { kind: "oauth_error", status: response.status, code: text_field(body?.error) ?? "", description: text_field(body?.error_description) ?? `HTTP ${response.status}${note}` };
  }
  if (!body) {
    return { kind: "malformed", detail: `the ChatGPT token endpoint answered HTTP ${response.status} without a JSON object${note}` };
  }
  return { kind: "tokens", fields: read_fields(body) };
};

export const exchange_code = (fetch: Fetch, grant: { client_id: string; code: string; code_verifier: string; redirect_uri: string }): Promise<TokenReply> =>
  token_request(fetch, {
    grant_type: "authorization_code",
    client_id: grant.client_id,
    code: grant.code,
    code_verifier: grant.code_verifier,
    redirect_uri: grant.redirect_uri,
    resource: api_resource,
  });

export const refresh_grant = (fetch: Fetch, grant: { client_id: string; refresh_token: string }): Promise<TokenReply> =>
  token_request(fetch, { grant_type: "refresh_token", client_id: grant.client_id, refresh_token: grant.refresh_token, resource: api_resource });

export const revoke_token = async (fetch: Fetch, grant: { client_id: string; refresh_token: string }): Promise<RevokeReply> => {
  let response: Response;
  let raw: string;
  try {
    response = await post_form(fetch, revocation_endpoint, { token: grant.refresh_token, token_type_hint: "refresh_token", client_id: grant.client_id });
    raw = await response.text();
  } catch (error) {
    return { kind: "unavailable", detail: `the ChatGPT revocation endpoint could not be reached: ${error_text(error)}` };
  }
  if (response.status === 200) {
    return { kind: "revoked" };
  }
  const code = text_field(parse_body(raw)?.error);
  const detail = `the ChatGPT revocation endpoint answered HTTP ${response.status}${code ? ` ${code}` : ""}${request_note(response)}`;
  return response.status >= 500 ? { kind: "unavailable", detail } : { kind: "refused", detail };
};

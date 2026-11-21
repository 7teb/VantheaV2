import { agent_name, api_resource, authorize_endpoint, registration_client_id, scope } from "./endpoints.ts";

export type AuthorizeRequest = {
  client_id: string;
  host_id: string;
  login_hint: string | null;
  redirect_uri: string;
  state: string;
  nonce: string;
  code_challenge: string;
  consent: boolean;
};

export const authorize_url = (request: AuthorizeRequest): string => {
  const params: [string, string][] = [["client_id", request.client_id]];
  if (request.client_id === registration_client_id) {
    params.push(["agent_name_hint", agent_name]);
  }
  params.push(["ext_agent_host_id", request.host_id]);
  if (request.login_hint) {
    params.push(["login_hint", request.login_hint]);
  }
  params.push(
    ["response_type", "code"],
    ["redirect_uri", request.redirect_uri],
    ["scope", scope],
    ["resource", api_resource],
    ["state", request.state],
    ["nonce", request.nonce],
    ["code_challenge_method", "S256"],
    ["code_challenge", request.code_challenge],
  );
  if (request.consent) {
    params.push(["prompt", "consent"]);
  }
  const query = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&");
  return `${authorize_endpoint}?${query}`;
};

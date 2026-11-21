import type { AccountModel } from "../../shared/chatgpt.ts";
import { error_text, is_record } from "../storage/coerce.ts";
import { models_endpoint, plan_scope } from "./endpoints.ts";
import { current_access_token, renew_access_token } from "./session.ts";
import type { ChatgptState } from "./state.ts";
import { parse_account_model, write_plain } from "./store.ts";

const fetch_models = (state: ChatgptState, token: string): Promise<Response> =>
  state.deps.fetch(models_endpoint, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error" });

const listed_models = (body: unknown): AccountModel[] => {
  if (!is_record(body) || !Array.isArray(body.models)) {
    throw new Error("the ChatGPT model list carries no models array");
  }
  const models: AccountModel[] = [];
  for (const entry of body.models) {
    const model = is_record(entry) && entry.visibility === "list" ? parse_account_model(entry) : null;
    if (model) {
      models.push(model);
    }
  }
  return models;
};

const same_models = (left: readonly AccountModel[] | null, right: readonly AccountModel[]): boolean => JSON.stringify(left) === JSON.stringify(right);

export const load_account_models = async (state: ChatgptState): Promise<boolean> => {
  const owner = state.session.account;
  if (!owner?.tokens || !owner.tokens.scopes.includes(plan_scope)) {
    return false;
  }
  const token = await current_access_token(state);
  let response = await fetch_models(state, token);
  if (response.status === 401) {
    response = await fetch_models(state, await renew_access_token(state, token));
  }
  if (!response.ok) {
    const id = response.headers.get("x-request-id") ?? response.headers.get("openai-request-id");
    throw new Error(`the ChatGPT model list answered HTTP ${response.status}${id ? ` (request ${id})` : ""}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`the ChatGPT model list is not valid JSON: ${error_text(error)}`, { cause: error });
  }
  const models = listed_models(body);
  const current = state.session.account;
  if (!current?.tokens || current.subject !== owner.subject || current.client_id !== owner.client_id) {
    return false;
  }
  const changed = !same_models(state.plain.models, models);
  const plain = { ...state.plain, models };
  await write_plain(state.deps.file, plain);
  state.plain = plain;
  return changed;
};

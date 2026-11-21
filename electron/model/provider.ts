import { plan_served, plan_slug } from "./catalog.ts";
import { complete, type CompleteResult } from "./complete.ts";
import type { CompleteRequest } from "./completion-body.ts";
import { complete_plan } from "./plan/complete.ts";
import { without_plan_items } from "./plan/input.ts";
import { plan_source } from "./plan/source.ts";
import { stream_plan_round } from "./plan/stream.ts";
import { stream_round } from "./stream.ts";
import type { Transport } from "./transport.ts";
import type { RoundCallbacks, RoundRequest, RoundResult } from "./types.ts";

const plan_billing = () => plan_source().billing() === "chatgpt";

export const stream_model = (request: RoundRequest, callbacks: RoundCallbacks, signal: AbortSignal, overrides?: Partial<Transport>): Promise<RoundResult> => {
  if (plan_billing() && plan_served(request.model, plan_source().account_models())) {
    return stream_plan_round(request, callbacks, signal, overrides);
  }
  const messages = without_plan_items(request.messages);
  return stream_round(messages === request.messages ? request : { ...request, messages }, callbacks, signal, overrides);
};

export const complete_model = (request: CompleteRequest, signal?: AbortSignal, overrides?: Partial<Transport>): Promise<CompleteResult> => {
  if (plan_billing() && plan_slug(request.model_id) !== null) {
    return complete_plan(request, signal, overrides);
  }
  const messages = without_plan_items(request.messages);
  return complete(messages === request.messages ? request : { ...request, messages }, signal, overrides);
};

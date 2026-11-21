import type { AccountModel } from "../../../shared/chatgpt.ts";
import type { BillingMode } from "../../../shared/settings.ts";

export type PlanSource = {
  billing: () => BillingMode;
  access_token: () => Promise<string>;
  renewed_token: (rejected: string) => Promise<string>;
  model_rejected: (model_id: string) => void;
  account_models: () => readonly AccountModel[] | null;
};

const unwired = (): Promise<string> => Promise.reject(new Error("the ChatGPT plan source is not wired"));

const initial_source: PlanSource = {
  billing: () => "api",
  access_token: unwired,
  renewed_token: unwired,
  model_rejected: () => undefined,
  account_models: () => null,
};

let current: PlanSource = initial_source;

export const set_plan_source = (source: PlanSource) => {
  current = source;
};

export const plan_source = (): PlanSource => current;

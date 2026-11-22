import type { AccountModel } from "../../shared/chatgpt.ts";
import type { ModelCatalog, ModelEntry } from "../../shared/models.ts";
import { account_models } from "../chatgpt/service.ts";
import { model_catalog } from "../model/catalog-file.ts";
import { get_settings } from "../settings/store.ts";
import { plan_models, unlisted_slugs, type PlanModels } from "./offered.ts";

export type PlanLists = PlanModels & { account: readonly AccountModel[] | null };

let noted_list = "";

const note_account = (models: readonly ModelEntry[], account: readonly AccountModel[] | null, plan_ids: readonly string[]) => {
  if (account === null) {
    return;
  }
  const key = JSON.stringify(account.map((model) => model.slug));
  if (key === noted_list) {
    return;
  }
  noted_list = key;
  const unlisted = unlisted_slugs(models, account);
  if (unlisted.length) {
    console.info(`[billing] account models without a catalog entry are not offered: ${unlisted.join(", ")}`);
  }
  if (!plan_ids.length) {
    console.warn(
      `[billing] the ChatGPT account lists none of the catalog's OpenAI models (account models: ${account.map((model) => model.slug).join(", ") || "none"}), so every model runs through the OpenRouter key and only the side jobs try the plan`,
    );
  }
};

export const plan_lists = async (): Promise<PlanLists> => {
  const catalog = await model_catalog();
  const account = account_models();
  const lists = plan_models(catalog.models, account);
  note_account(catalog.models, account, lists.plan_ids);
  return { ...lists, account };
};

const with_claude_plan = (catalog: ModelCatalog): ModelCatalog =>
  get_settings().claude_billing === "claude"
    ? { ...catalog, claude_plan_ids: catalog.models.filter((model) => model.claude_code !== undefined).map((model) => model.id) }
    : catalog;

export const billing_catalog = async (): Promise<ModelCatalog> => {
  const catalog = await model_catalog();
  if (get_settings().billing !== "chatgpt") {
    return with_claude_plan(catalog);
  }
  const { models, plan_ids, pro_locked } = await plan_lists();
  return with_claude_plan({ ...catalog, models, plan_ids, ...(pro_locked.length ? { pro_locked } : {}) });
};

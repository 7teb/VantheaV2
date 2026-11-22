import { flex_id, with_tier, type ModelCatalog, type ModelEntry } from "../../../shared/models.ts";
import type { ModelPrice } from "../../../shared/tool-view.ts";
import { billing_catalog } from "../../billing/catalog.ts";
import { major_effort } from "../../model/catalog.ts";
import { model_price, price_line } from "../../model/pricing.ts";
import { guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";

const parallel_lookups = 4;

const with_flex_variants = (models: ModelEntry[], included: (id: string) => boolean): ModelEntry[] =>
  models.flatMap((model) => (model.tiers?.flex && !included(model.id) ? [model, { ...with_tier(model, "flex"), id: flex_id(model.id) }] : [model]));

const included_row = (model: ModelEntry, marker: Pick<ModelPrice, "plan" | "claude_plan">): ModelPrice => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  endpoint: "",
  input: null,
  output: null,
  cache_read: null,
  long_context: null,
  context_length: model.context_length,
  efforts: model.efforts.filter((effort) => effort !== major_effort),
  note: model.note ?? "",
  error: "",
  ...marker,
});

const included_line = (model: ModelPrice, plan: string): string => {
  const efforts = model.efforts.length ? model.efforts.join(", ") : "none";
  return `${model.id} | ${model.label} | ${model.provider} | included in ${plan}, no per-token price | context ${model.context_length} | efforts ${efforts}${model.note ? ` | ${model.note}` : ""}`;
};

const chatgpt_plan = "the ChatGPT plan";

const claude_plan = "the Claude plan";

const model_line = (model: ModelPrice): string => {
  if (model.plan) {
    return included_line(model, chatgpt_plan);
  }
  return model.claude_plan ? included_line(model, claude_plan) : price_line(model);
};

const price_header = "Models (prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to";

const list_header = (catalog: ModelCatalog): string => {
  const plans = [...(catalog.plan_ids ? [chatgpt_plan] : []), ...(catalog.claude_plan_ids ? [claude_plan] : [])];
  return plans.length ? `${price_header}; models marked as included in ${plans.join(" or ")} have no per-token price):` : `${price_header}):`;
};

export const list_models_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_models",
    description:
      "List the models available in this app: the exact model id (what deploy_agent's model takes), name, provider endpoint, current OpenRouter price in USD per 1M input and output tokens, context window and reasoning efforts. When the app bills through a ChatGPT plan, the OpenAI models the plan serves are marked as included in the plan without a price, and every other model runs through OpenRouter at the listed price. When the app bills Claude models through a Claude plan, those models are marked as included in the Claude plan without a price.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan", "explore", "worker"],
  concurrent: true,
  parse: () => ({}),
  run: (ctx) =>
    guarded(ctx, "list_models", async () => {
      const catalog = await billing_catalog();
      const plan_ids = new Set(catalog.plan_ids ?? []);
      const claude_ids = new Set(catalog.claude_plan_ids ?? []);
      const listed = with_flex_variants(catalog.models, (id) => plan_ids.has(id) || claude_ids.has(id));
      const row = (model: ModelEntry): ModelPrice | Promise<ModelPrice> => {
        if (plan_ids.has(model.id)) {
          return included_row(model, { plan: true });
        }
        return claude_ids.has(model.id) ? included_row(model, { claude_plan: true }) : model_price(model, ctx.signal);
      };
      const models: ModelPrice[] = [];
      for (let start = 0; start < listed.length; start += parallel_lookups) {
        const batch = listed.slice(start, start + parallel_lookups);
        models.push(...(await Promise.all(batch.map(row))));
      }
      const text = [list_header(catalog), ...models.map(model_line)].join("\n");
      return { status: "done", text, view: { kind: "models", models } };
    }),
});

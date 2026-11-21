import { flex_id, with_tier, type ModelEntry } from "../../../shared/models.ts";
import type { ModelPrice } from "../../../shared/tool-view.ts";
import { billing_catalog } from "../../billing/catalog.ts";
import { major_effort } from "../../model/catalog.ts";
import { model_price, price_line } from "../../model/pricing.ts";
import { guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";

const parallel_lookups = 4;

const with_flex_variants = (models: ModelEntry[], plan_ids: ReadonlySet<string>): ModelEntry[] =>
  models.flatMap((model) => (model.tiers?.flex && !plan_ids.has(model.id) ? [model, { ...with_tier(model, "flex"), id: flex_id(model.id) }] : [model]));

const plan_row = (model: ModelEntry): ModelPrice => ({
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
  plan: true,
});

const plan_line = (model: ModelPrice): string => {
  const efforts = model.efforts.length ? model.efforts.join(", ") : "none";
  return `${model.id} | ${model.label} | ${model.provider} | included in the ChatGPT plan, no per-token price | context ${model.context_length} | efforts ${efforts}${model.note ? ` | ${model.note}` : ""}`;
};

export const list_models_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_models",
    description:
      "List the models available in this app: the exact model id (what deploy_agent's model takes), name, provider endpoint, current OpenRouter price in USD per 1M input and output tokens, context window and reasoning efforts. When the app bills through a ChatGPT plan, the OpenAI models the plan serves are marked as included in the plan without a price, and every other model runs through OpenRouter at the listed price.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan", "explore", "worker"],
  concurrent: true,
  parse: () => ({}),
  run: (ctx) =>
    guarded(ctx, "list_models", async () => {
      const catalog = await billing_catalog();
      const plan_ids = new Set(catalog.plan_ids ?? []);
      const listed = with_flex_variants(catalog.models, plan_ids);
      const models: ModelPrice[] = [];
      for (let start = 0; start < listed.length; start += parallel_lookups) {
        const batch = listed.slice(start, start + parallel_lookups);
        models.push(...(await Promise.all(batch.map((model) => (plan_ids.has(model.id) ? plan_row(model) : model_price(model, ctx.signal))))));
      }
      const header = catalog.plan_ids
        ? "Models (prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to; models marked as included in the ChatGPT plan have no per-token price):"
        : "Models (prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to):";
      const text = [header, ...models.map((model) => (model.plan ? plan_line(model) : price_line(model)))].join("\n");
      return { status: "done", text, view: { kind: "models", models } };
    }),
});

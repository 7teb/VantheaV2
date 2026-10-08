import type { ModelPrice } from "../../../shared/tool-view.ts";
import { model_catalog } from "../../model/catalog-file.ts";
import { model_price, price_line } from "../../model/pricing.ts";
import { guarded } from "../fs/common.ts";
import { define_tool } from "../types.ts";

const parallel_lookups = 4;

export const list_models_tool = define_tool<Record<string, never>>({
  spec: {
    name: "list_models",
    description:
      "List the models available in this app: the exact model id to pass to deploy_agent, name, provider endpoint, current OpenRouter price in USD per 1M input and output tokens, context window and reasoning efforts.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  profiles: ["main", "plan", "explore", "worker"],
  parse: () => ({}),
  run: (ctx) =>
    guarded(ctx, "list_models", async () => {
      const catalog = await model_catalog();
      const models: ModelPrice[] = [];
      for (let start = 0; start < catalog.models.length; start += parallel_lookups) {
        models.push(...(await Promise.all(catalog.models.slice(start, start + parallel_lookups).map((model) => model_price(model, ctx.signal)))));
      }
      const text = ["Models (prices in USD per 1M tokens, current OpenRouter pricing of the endpoint each model is routed to):", ...models.map(price_line)].join("\n");
      return { status: "done", text, view: { kind: "models", models } };
    }),
});

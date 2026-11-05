import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { set_key_source } from "../electron/model/key.ts";
import { base_model_id, model_price, parse_endpoints, pick_endpoint, price_line } from "../electron/model/pricing.ts";

const body = JSON.stringify({
  data: {
    endpoints: [
      { tag: "openai/flex", pricing: { prompt: "0.000001", completion: "0.000005", input_cache_read: "0.00000005", overrides: [{ min_prompt_tokens: 272000, prompt: "0.000002", completion: "0.0000075" }] } },
      { tag: "azure", pricing: { prompt: "0.0000022", completion: "0.000011" } },
      { tag: "openai", pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001" } },
      { tag: "broken" },
    ],
  },
});

const entry = (extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id: "openai/gpt-6.1-sol:floor",
  label: "GPT 6.1 Sol Flex",
  provider: "OpenAI",
  provider_order: ["openai/flex", "openai"],
  efforts: ["low", "high", "major"],
  default_effort: "high",
  vision: true,
  context_length: 1050000,
  max_output: 128000,
  reasoning_passback: false,
  ...extra,
});

test("endpoint prices are read per 1M tokens, including the long context override", () => {
  const endpoints = parse_endpoints(body);
  assert.equal(endpoints.length, 3);
  assert.deepEqual(endpoints[0], { tag: "openai/flex", input: 1, output: 5, cache_read: 0.05, long_context: { min_prompt_tokens: 272000, input: 2, output: 7.5 } });
  assert.equal(endpoints[1]?.cache_read, null);
  assert.throws(() => parse_endpoints("not json"), /unreadable endpoint information/);
  assert.throws(() => parse_endpoints("{}"), /no endpoint list/);
});

test("the first pinned endpoint wins, otherwise the cheapest one is reported as unpinned", () => {
  const endpoints = parse_endpoints(body);
  assert.deepEqual(pick_endpoint(endpoints, ["openai/flex", "openai"]), { endpoint: endpoints[0], pinned: true });
  assert.equal(pick_endpoint(endpoints, ["missing", "openai"])?.endpoint.tag, "openai");
  assert.deepEqual(pick_endpoint(endpoints, []), { endpoint: endpoints[0], pinned: false });
  assert.equal(pick_endpoint([], ["openai"]), null);
  assert.equal(base_model_id("openai/gpt-6.1-sol:floor"), "openai/gpt-6.1-sol");
  assert.equal(base_model_id("deepseek/deepseek-v4.1-flash"), "deepseek/deepseek-v4.1-flash");
});

test("a model price comes from its pinned endpoint and failures stay visible per model", async () => {
  set_key_source(() => "sk-or-test");
  const routes: string[] = [];
  const signal = new AbortController().signal;
  const ok = await model_price(entry(), signal, {
    fetch: async (url) => {
      routes.push(url);
      return new Response(body, { status: 200 });
    },
  });
  assert.deepEqual(routes, ["https://openrouter.ai/api/v1/models/openai/gpt-6.1-sol/endpoints"]);
  assert.equal(ok.endpoint, "openai/flex");
  assert.equal(ok.input, 1);
  assert.deepEqual(ok.efforts, ["low", "high"]);
  assert.match(price_line(ok), /^openai\/gpt-6\.1-sol:floor \| GPT 6\.1 Sol Flex \| OpenAI via openai\/flex \| input 1, output 5, cache read 0\.05; above 272000 prompt tokens input 2, output 7\.5 \| context 1050000 \| efforts low, high$/);
  const noted = await model_price(entry({ note: "Very fast, for small tasks." }), signal, { fetch: async () => new Response(body, { status: 200 }) });
  assert.match(price_line(noted), /\| efforts low, high \| Very fast, for small tasks\.$/);
  const failed = await model_price(entry({ id: "x/unknown" }), signal, { fetch: async () => new Response("{}", { status: 200 }) });
  let calls = 0;
  const flaky = await model_price(entry({ id: "x/flaky" }), signal, {
    sleep: async () => undefined,
    fetch: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ETIMEDOUT" } });
      }
      return new Response(body, { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(flaky.input, 1);
  const controller = new AbortController();
  controller.abort(new Error("turn stopped"));
  await assert.rejects(model_price(entry({ id: "x/aborted" }), controller.signal, { fetch: async () => new Response(body, { status: 200 }) }), /turn stopped/);
  assert.equal(failed.input, null);
  assert.match(failed.error, /no endpoint list/);
  assert.match(price_line(failed), /price unavailable: .*no endpoint list/);
});

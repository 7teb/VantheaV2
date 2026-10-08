import type { ModelEntry } from "../../shared/models.ts";
import type { ModelPrice } from "../../shared/tool-view.ts";
import { major_effort } from "./catalog.ts";
import { ModelError } from "./errors.ts";
import { as_number, as_record, as_string } from "./json.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "./transport.ts";

export type EndpointPrice = {
  tag: string;
  input: number | null;
  output: number | null;
  cache_read: number | null;
  long_context: { min_prompt_tokens: number; input: number | null; output: number | null } | null;
};

const cache_ms = 600000;

const cache = new Map<string, { at: number; endpoints: EndpointPrice[] }>();

const per_million = (value: unknown): number | null => {
  const text = as_string(value);
  const amount = Number(text);
  return text && Number.isFinite(amount) ? Number((amount * 1_000_000).toPrecision(6)) : null;
};

export const base_model_id = (id: string): string => id.replace(/:[a-z]+$/, "");

export const parse_endpoints = (text: string): EndpointPrice[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[model] endpoints body is not JSON (${String(error)}): ${text.slice(0, 200)}`);
    throw new ModelError("provider_unavailable", "OpenRouter returned unreadable endpoint information.");
  }
  const endpoints = as_record(as_record(parsed)?.data)?.endpoints;
  if (!Array.isArray(endpoints)) {
    throw new ModelError("provider_unavailable", "OpenRouter endpoint information has no endpoint list.");
  }
  return endpoints.flatMap((value) => {
    const endpoint = as_record(value);
    const pricing = as_record(endpoint?.pricing);
    if (!endpoint || !pricing) {
      return [];
    }
    const override = Array.isArray(pricing.overrides) ? as_record(pricing.overrides[0]) : null;
    const threshold = as_number(override?.min_prompt_tokens);
    return [
      {
        tag: as_string(endpoint.tag),
        input: per_million(pricing.prompt),
        output: per_million(pricing.completion),
        cache_read: per_million(pricing.input_cache_read),
        long_context: override && threshold !== null ? { min_prompt_tokens: threshold, input: per_million(override.prompt), output: per_million(override.completion) } : null,
      },
    ];
  });
};

export const pick_endpoint = (endpoints: EndpointPrice[], provider_order: string[]): { endpoint: EndpointPrice; pinned: boolean } | null => {
  for (const tag of provider_order) {
    const pinned = endpoints.find((endpoint) => endpoint.tag === tag);
    if (pinned) {
      return { endpoint: pinned, pinned: true };
    }
  }
  const priced = endpoints.filter((endpoint) => endpoint.input !== null);
  const cheapest = priced.sort((a, b) => (a.input ?? 0) - (b.input ?? 0))[0];
  return cheapest ? { endpoint: cheapest, pinned: false } : null;
};

const fetch_endpoints = async (base: string, signal: AbortSignal, transport: Transport): Promise<EndpointPrice[]> => {
  const watchdog = create_watchdog(signal);
  watchdog.arm(15000, "first_byte");
  try {
    const response = await send("GET", `/models/${base}/endpoints`, null, watchdog, transport);
    return parse_endpoints(await response.text());
  } catch (error) {
    throw attempt_failure(error, watchdog, "read");
  } finally {
    watchdog.dispose();
  }
};

const read_endpoints = async (model_id: string, signal: AbortSignal, overrides: Partial<Transport>): Promise<EndpointPrice[]> => {
  const base = base_model_id(model_id);
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < cache_ms) {
    return hit.endpoints;
  }
  const transport = transport_with(overrides);
  const endpoints = await with_retries({
    transport,
    signal,
    run: () => fetch_endpoints(base, signal, transport),
    cancelled: () => {
      throw signal.reason ?? new Error(`price lookup for ${base} was cancelled`);
    },
  });
  cache.set(base, { at: Date.now(), endpoints });
  return endpoints;
};

const usd = (value: number | null) => (value === null ? "n/a" : String(value));

export const price_line = (model: ModelPrice): string => {
  const via = model.endpoint ? ` via ${model.endpoint}` : " (cheapest endpoint, no pinned provider matched)";
  const long = model.long_context ? `; above ${model.long_context.min_prompt_tokens} prompt tokens input ${usd(model.long_context.input)}, output ${usd(model.long_context.output)}` : "";
  const price = model.error
    ? `price unavailable: ${model.error}`
    : `input ${usd(model.input)}, output ${usd(model.output)}${model.cache_read === null ? "" : `, cache read ${usd(model.cache_read)}`}${long}`;
  const efforts = model.efforts.length ? model.efforts.join(", ") : "none";
  return `${model.id} | ${model.label} | ${model.provider}${model.error ? "" : via} | ${price} | context ${model.context_length} | efforts ${efforts}${model.note ? ` | ${model.note}` : ""}`;
};

export const model_price = async (model: ModelEntry, signal: AbortSignal, overrides: Partial<Transport> = {}): Promise<ModelPrice> => {
  const base: ModelPrice = {
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
  };
  try {
    const picked = pick_endpoint(await read_endpoints(model.id, signal, overrides), model.provider_order);
    if (!picked) {
      return { ...base, error: "OpenRouter lists no priced endpoint for this model." };
    }
    const { endpoint, pinned } = picked;
    return { ...base, endpoint: pinned ? endpoint.tag : "", input: endpoint.input, output: endpoint.output, cache_read: endpoint.cache_read, long_context: endpoint.long_context };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[model] price lookup for ${model.id} failed: ${message}`);
    return { ...base, error: message };
  }
};

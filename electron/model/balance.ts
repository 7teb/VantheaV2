import type { Balance } from "../../shared/settings.ts";
import { ModelError } from "./errors.ts";
import { as_number, as_record } from "./json.ts";
import { current_key } from "./key.ts";
import { attempt_failure, create_watchdog, send, transport_with, type Transport } from "./transport.ts";

const cache_ms = 60000;

let cached: { key: string; at: number; balance: Balance } | null = null;

export const read_key_info = (text: string): Balance => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[model] /key body is not JSON (${String(error)}): ${text.slice(0, 200)}`);
    throw new ModelError("provider_unavailable", "OpenRouter returned unreadable key information.");
  }
  const data = as_record(as_record(parsed)?.data);
  const usage = as_number(data?.usage);
  if (!data || usage === null) {
    throw new ModelError("provider_unavailable", "OpenRouter key information has no usage figure.");
  }
  return { limit: as_number(data.limit), usage, remaining: as_number(data.limit_remaining) };
};

export const read_balance = async (overrides: Partial<Transport> = {}): Promise<Balance | null> => {
  const key = current_key();
  if (!key) {
    return null;
  }
  if (cached && cached.key === key && Date.now() - cached.at < cache_ms) {
    return cached.balance;
  }
  const transport = transport_with(overrides);
  const watchdog = create_watchdog(new AbortController().signal);
  watchdog.arm(10000, "first_byte");
  try {
    const response = await send("GET", "/key", null, watchdog, transport);
    const balance = read_key_info(await response.text());
    cached = { key, at: Date.now(), balance };
    return balance;
  } catch (error) {
    throw attempt_failure(error, watchdog, "read");
  } finally {
    watchdog.dispose();
  }
};

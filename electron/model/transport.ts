import {
  classify_provider_error,
  is_retryable,
  ModelError,
  network_error,
  parse_error_body,
  parse_retry_after,
  retry_delay,
} from "./errors.ts";
import { current_key } from "./key.ts";

export const api_base = "https://openrouter.ai/api/v1";

export type Transport = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
  max_attempts: number;
  first_byte_ms: number;
  idle_ms: number;
};

export const abortable_sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });

const default_transport: Transport = {
  fetch: (url, init) => fetch(url, init),
  sleep: abortable_sleep,
  random: Math.random,
  max_attempts: 3,
  first_byte_ms: 300000,
  idle_ms: 240000,
};

export const transport_with = (overrides: Partial<Transport> = {}): Transport => ({ ...default_transport, ...overrides });

type Expiry = { phase: "first_byte" | "idle"; ms: number };

export type Watchdog = {
  signal: AbortSignal;
  arm(ms: number, phase: Expiry["phase"]): void;
  expired(): Expiry | null;
  dispose(): void;
};

export const create_watchdog = (parent: AbortSignal): Watchdog => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiry: Expiry | null = null;
  const forward = () => controller.abort(parent.reason);
  if (parent.aborted) {
    controller.abort(parent.reason);
  }
  parent.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    arm: (ms, phase) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        expiry = { phase, ms };
        controller.abort(new Error(`openrouter ${phase} timeout after ${ms} ms`));
      }, ms);
    },
    expired: () => expiry,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", forward);
      controller.abort();
    },
  };
};

const timeout_error = (expiry: Expiry) => {
  const seconds = Math.round(expiry.ms / 1000);
  return new ModelError(
    "timeout",
    expiry.phase === "first_byte"
      ? `OpenRouter sent nothing for ${seconds} s after the request.`
      : `The OpenRouter stream went silent for ${seconds} s before the answer was complete.`,
  );
};

export const attempt_failure = (error: unknown, watchdog: Watchdog, phase: "connect" | "read"): ModelError => {
  if (error instanceof ModelError) {
    return error;
  }
  const expiry = watchdog.expired();
  return expiry ? timeout_error(expiry) : network_error(error, phase);
};

const request_headers = (): Record<string, string> => {
  const key = current_key();
  if (!key) {
    throw new ModelError("auth", "No OpenRouter API key is set. Add one in Settings.");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost",
    "X-OpenRouter-Title": "VantheaX",
  };
};

export const send = async (method: "GET" | "POST", route: string, body: string | null, watchdog: Watchdog, transport: Transport) => {
  const headers = request_headers();
  let response: Response;
  try {
    response = await transport.fetch(`${api_base}${route}`, { method, headers, body, signal: watchdog.signal });
  } catch (error) {
    throw attempt_failure(error, watchdog, "connect");
  }
  if (response.ok) {
    return response;
  }
  let text = "";
  try {
    text = await response.text();
  } catch (error) {
    console.warn(`[model] ${method} ${route} returned ${response.status} and its error body could not be read: ${String(error)}`);
  }
  const retry_after = parse_retry_after(response.headers.get("retry-after"));
  throw classify_provider_error(response.status, parse_error_body(text), text, retry_after);
};

export type RetryPlan<T> = {
  transport: Transport;
  signal: AbortSignal;
  run: (attempt: number) => Promise<T>;
  cancelled: () => T;
  on_retry?: (attempt: number, max: number, reason: string, wait_ms: number) => void;
};

export const with_retries = async <T>(plan: RetryPlan<T>): Promise<T> => {
  const { transport, signal } = plan;
  for (let attempt = 1; ; attempt += 1) {
    if (signal.aborted) {
      return plan.cancelled();
    }
    try {
      return await plan.run(attempt);
    } catch (error) {
      if (signal.aborted) {
        return plan.cancelled();
      }
      if (!(error instanceof ModelError) || !is_retryable(error)) {
        throw error;
      }
      if (attempt >= transport.max_attempts) {
        throw attempt > 1 ? new ModelError(error.kind, `${error.message} (gave up after ${attempt} attempts)`, error.status) : error;
      }
      const wait_ms = retry_delay(attempt, error, transport.random);
      console.warn(`[model] attempt ${attempt} failed (${error.kind}), retrying in ${wait_ms} ms: ${error.message}`);
      plan.on_retry?.(attempt + 1, transport.max_attempts, error.kind, wait_ms);
      await transport.sleep(wait_ms, signal);
    }
  }
};

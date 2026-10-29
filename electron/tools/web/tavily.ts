import type { WebFailure } from "../../../shared/tool-view.ts";
import { parse_retry_after } from "../../model/errors.ts";
import { abortable_sleep } from "../../model/transport.ts";
import { as_array, as_record, as_string, error_text } from "../../storage/coerce.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type SourceText = { title: string; url: string; content: string; published_date: string };

export type TimeRange = "day" | "week" | "month" | "year";

export const time_ranges: readonly TimeRange[] = ["day", "week", "month", "year"];

export type SearchOptions = { query: string; topic: "general" | "news"; max_results: number; time_range: TimeRange | null };

export const tavily_base = "https://api.tavily.com";

const max_attempts = 3;

const backoff_ms = [1000, 3000];

const max_retry_wait_ms = 10000;

const attempt_timeout_ms = 60000;

const retry_statuses = new Set([429, 500, 502, 503, 504]);

const web_url = (value: unknown): string => {
  const text = as_string(value).trim();
  return /^https?:\/\//i.test(text) ? text : "";
};

const clean_title = (value: unknown, url: string) => as_string(value).replace(/\s+/g, " ").trim().slice(0, 160) || url;

export const search_body = (options: SearchOptions) => ({
  query: options.query,
  search_depth: "basic",
  topic: options.topic,
  max_results: Math.min(20, Math.max(1, Math.round(options.max_results))),
  include_answer: false,
  include_raw_content: false,
  include_published_date: true,
  ...(options.time_range ? { time_range: options.time_range } : {}),
});

export const extract_body = (urls: string[]) => ({
  urls,
  extract_depth: "basic",
  format: "markdown",
});

export const map_search_results = (value: unknown): SourceText[] =>
  as_array(as_record(value).results).flatMap((entry) => {
    const raw = as_record(entry);
    const url = web_url(raw.url);
    if (!url) {
      return [];
    }
    return [{ title: clean_title(raw.title, url), url, content: as_string(raw.content), published_date: as_string(raw.published_date).trim() }];
  });

export const map_extract_results = (value: unknown): SourceText[] =>
  as_array(as_record(value).results).flatMap((entry) => {
    const raw = as_record(entry);
    const url = web_url(raw.url);
    return url ? [{ title: clean_title(raw.title, url), url, content: as_string(raw.raw_content), published_date: "" }] : [];
  });

export const failed_extracts = (value: unknown): WebFailure[] =>
  as_array(as_record(value).failed_results).map((entry) => {
    const raw = as_record(entry);
    return { url: as_string(raw.url), error: as_string(raw.error) || "failed" };
  });

export const tavily_error_detail = (text: string): string => {
  try {
    const detail = as_record(JSON.parse(text)).detail;
    if (Array.isArray(detail)) {
      return detail.map((entry) => as_string(as_record(entry).msg)).filter(Boolean).join("; ") || text.slice(0, 300);
    }
    return as_string(as_record(detail).error) || text.slice(0, 300);
  } catch (error) {
    console.warn(`[web] Tavily error body is not JSON (${error_text(error)}): ${text.slice(0, 200)}`);
    return text.slice(0, 300);
  }
};

const retry_wait = (response: Response, attempt: number): number => {
  const requested = parse_retry_after(response.headers.get("retry-after"));
  return Math.min(max_retry_wait_ms, requested || (backoff_ms[attempt - 1] ?? 3000));
};

const attempt_post = async (fetch_fn: FetchFn, key: string, route: string, body: unknown, signal: AbortSignal) => {
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(attempt_timeout_ms)]);
  try {
    const response = await fetch_fn(`${tavily_base}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: attempt,
    });
    return { response, text: await response.text() };
  } catch (error) {
    if (signal.aborted || !attempt.aborted) {
      throw error;
    }
    throw new Error(`Tavily ${route} did not answer within ${attempt_timeout_ms / 1000} s`, { cause: error });
  }
};

export const tavily_post = async (fetch_fn: FetchFn, key: string, route: "/search" | "/extract", body: unknown, signal: AbortSignal): Promise<unknown> => {
  for (let attempt = 1; ; attempt += 1) {
    const { response, text } = await attempt_post(fetch_fn, key, route, body, signal);
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`Tavily returned an unreadable ${route} response (${error_text(error)}): ${text.slice(0, 200)}`, { cause: error });
      }
    }
    const detail = tavily_error_detail(text);
    if (!retry_statuses.has(response.status) || attempt >= max_attempts) {
      throw new Error(`Tavily ${response.status}: ${detail}`);
    }
    const wait_ms = retry_wait(response, attempt);
    console.warn(`[web] Tavily ${route} returned ${response.status}, retrying in ${wait_ms} ms: ${detail}`);
    await abortable_sleep(wait_ms, signal);
    signal.throwIfAborted();
  }
};

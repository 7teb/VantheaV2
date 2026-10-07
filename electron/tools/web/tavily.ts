import { parse_retry_after } from "../../model/errors.ts";
import { abortable_sleep } from "../../model/transport.ts";
import { as_array, as_record, as_string, error_text } from "../../storage/coerce.ts";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type SourceText = { title: string; url: string; content: string };

export type SearchOptions = { query: string; depth: "basic" | "advanced"; topic: "general" | "news"; max_results: number };

export const tavily_base = "https://api.tavily.com";

export const max_source_chars = 4000;

const max_attempts = 3;

const backoff_ms = [1000, 3000];

const max_retry_wait_ms = 10000;

const retry_statuses = new Set([429, 500, 502, 503, 504]);

const web_url = (value: unknown): string => {
  const text = as_string(value).trim();
  return /^https?:\/\//i.test(text) ? text : "";
};

export const search_body = (options: SearchOptions) => ({
  query: options.query,
  search_depth: options.depth,
  topic: options.topic,
  max_results: Math.min(20, Math.max(1, Math.round(options.max_results))),
  include_answer: false,
  include_raw_content: false,
});

export const extract_body = (urls: string[], query: string, depth: "basic" | "advanced") => ({
  urls,
  query,
  extract_depth: depth,
  format: "text",
});

export const map_search_results = (value: unknown): SourceText[] =>
  as_array(as_record(value).results).flatMap((entry) => {
    const raw = as_record(entry);
    const url = web_url(raw.url);
    if (!url) {
      return [];
    }
    const title = as_string(raw.title).replace(/\s+/g, " ").trim().slice(0, 160) || url;
    return [{ title, url, content: as_string(raw.content).slice(0, max_source_chars) }];
  });

export const map_extract_results = (value: unknown): SourceText[] =>
  as_array(as_record(value).results).flatMap((entry) => {
    const raw = as_record(entry);
    const url = web_url(raw.url);
    return url ? [{ title: url, url, content: as_string(raw.raw_content).slice(0, max_source_chars) }] : [];
  });

export const failed_extracts = (value: unknown): string[] =>
  as_array(as_record(value).failed_results).map((entry) => {
    const raw = as_record(entry);
    return `${as_string(raw.url)}: ${as_string(raw.error) || "failed"}`;
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

export const tavily_post = async (fetch_fn: FetchFn, key: string, route: "/search" | "/extract", body: unknown, signal: AbortSignal): Promise<unknown> => {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch_fn(`${tavily_base}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (response.ok) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(`Tavily returned an unreadable ${route} response (${error_text(error)}): ${text.slice(0, 200)}`, { cause: error });
      }
    }
    const detail = tavily_error_detail(await response.text());
    if (!retry_statuses.has(response.status) || attempt >= max_attempts) {
      throw new Error(`Tavily ${response.status}: ${detail}`);
    }
    const wait_ms = retry_wait(response, attempt);
    console.warn(`[web] Tavily ${route} returned ${response.status}, retrying in ${wait_ms} ms: ${detail}`);
    await abortable_sleep(wait_ms, signal);
    signal.throwIfAborted();
  }
};

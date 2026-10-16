import { host_kind_of } from "../../shared/git/remote-url.ts";
import { error_text, is_record } from "../storage/coerce.ts";

export type GithubSource = { kind: "anonymous" } | { kind: "gh"; login: string };

export type RawResponse = { status: number; headers: Record<string, string>; body: string };

export type Transported = { kind: "response"; response: RawResponse } | { kind: "offline"; detail: string } | { kind: "signed_out"; detail: string };

export type TransportCall = { host: string; path: string; headers: Record<string, string>; signal: AbortSignal };

export type GithubTransport = (call: TransportCall) => Promise<Transported>;

export type NetInit = { headers: Record<string, string>; signal: AbortSignal; cache: "no-store"; credentials: "omit"; redirect: "follow" };

export type NetFetch = (url: string, init: NetInit) => Promise<Response>;

export type RoundTally = { counted: number; max_age_ms: number | null; poll_ms: number | null };

export type GithubRequest = { source: GithubSource; host: string; path: string; signal: AbortSignal; tally: RoundTally };

export type GithubFailure =
  | { kind: "missing"; status: number }
  | { kind: "denied"; sso: string | null }
  | { kind: "unauthorized" }
  | { kind: "rate_limited"; reset_at: number }
  | { kind: "server_error"; status: number | null }
  | { kind: "offline" };

export type GithubResult = { kind: "ok"; body: unknown; next: string | null } | GithubFailure;

export type GithubPages = { kind: "ok"; bodies: unknown[] } | GithubFailure;

export type RateState = { remaining: number | null; reset_at: number | null; blocked_until: number | null };

export type GithubClient = {
  get: (request: GithubRequest) => Promise<GithubResult>;
  get_pages: (request: GithubRequest) => Promise<GithubPages>;
  rate: (source: GithubSource, host: string) => RateState;
  prune: (tally: RoundTally) => void;
};

export type ClientDeps = { anonymous: GithubTransport; gh: GithubTransport; now?: () => number };

type CacheEntry = { etag: string; body: unknown; next: string | null; used: RoundTally };

export const api_version = "2026-03-10";

const minimum_wait_ms = 60_000;

const no_rate: RateState = { remaining: null, reset_at: null, blocked_until: null };

const settled = () => undefined;

export const api_base = (host: string): string => {
  if (host === "github.com") return "https://api.github.com/";
  if (host.endsWith(".ghe.com")) return `https://api.${host}/`;
  return `https://${host}/api/v3/`;
};

export const api_path = (segments: readonly string[], query?: Record<string, string>): string => {
  const path = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const search = query ? new URLSearchParams(query).toString() : "";
  return search ? `${path}?${search}` : path;
};

export const next_link = (link: string | undefined): string | null => {
  for (const part of (link ?? "").split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]*)"/.exec(part);
    if (match?.[2]?.split(/\s+/).includes("next")) return match[1] ?? null;
  }
  return null;
};

export const relative_link = (url: string, host: string): string | null => {
  const base = api_base(host);
  const path = url.startsWith(base) ? url.slice(base.length) : "";
  return /^[A-Za-z0-9]/.test(path) ? path : null;
};

const numeric = (value: string | undefined): number | null => (value !== undefined && /^\d+$/.test(value.trim()) ? Number(value) : null);

export const max_age_ms = (cache_control: string | undefined): number | null => {
  const seconds = /(?:^|,)\s*max-age=(\d+)/i.exec(cache_control ?? "")?.[1];
  return seconds === undefined ? null : Number(seconds) * 1000;
};

export const sso_header_url = (header: string | undefined): string | null => /\burl=(\S+)/.exec(header ?? "")?.[1] ?? null;

const parse_body = (request: GithubRequest, status: number, text: string): { value: unknown } | null => {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    console.warn(`[github] GET ${request.host} ${request.path} answered ${status} with a body that is not JSON: ${error_text(error)}`);
    return null;
  }
};

const message_of = (request: GithubRequest, response: RawResponse): string => {
  const parsed = response.body.trim() ? parse_body(request, response.status, response.body) : null;
  return parsed && is_record(parsed.value) && typeof parsed.value.message === "string" ? parsed.value.message : "";
};

const identity_of = (source: GithubSource): string => (source.kind === "gh" ? `gh:${source.login}` : "anonymous");

export const net_transport =
  (fetcher: NetFetch): GithubTransport =>
  async ({ host, path, headers, signal }) => {
    try {
      const response = await fetcher(`${api_base(host)}${path}`, { headers, signal, cache: "no-store", credentials: "omit", redirect: "follow" });
      const received: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        received[name.toLowerCase()] = value;
      });
      return { kind: "response", response: { status: response.status, headers: received, body: await response.text() } };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      return { kind: "offline", detail: error_text(error) };
    }
  };

export const create_github_client = (deps: ClientDeps): GithubClient => {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const rates = new Map<string, RateState>();
  const queues = new Map<string, Promise<unknown>>();

  const rate_key = (source: GithubSource, host: string) => `${host}\n${identity_of(source)}`;

  const note_rate = (key: string, headers: Record<string, string>) => {
    const known = rates.get(key) ?? no_rate;
    const remaining = numeric(headers["x-ratelimit-remaining"]);
    const reset = numeric(headers["x-ratelimit-reset"]);
    rates.set(key, { ...known, remaining: remaining ?? known.remaining, reset_at: reset === null ? known.reset_at : reset * 1000 });
  };

  const limit_until = (request: GithubRequest, response: RawResponse): number | null => {
    const { headers, status } = response;
    const retry = numeric(headers["retry-after"]);
    if (retry !== null) return now() + retry * 1000;
    if (headers["x-ratelimit-remaining"] === "0") {
      const reset = numeric(headers["x-ratelimit-reset"]);
      return reset === null ? now() + minimum_wait_ms : reset * 1000;
    }
    return status === 429 || /rate limit/i.test(message_of(request, response)) ? now() + minimum_wait_ms : null;
  };

  const settle = (request: GithubRequest, key: string, cache_key: string, response: RawResponse): GithubResult => {
    const { status, headers } = response;
    if (status === 304) {
      const entry = cache.get(cache_key);
      if (!entry) return { kind: "server_error", status };
      entry.used = request.tally;
      return { kind: "ok", body: entry.body, next: entry.next };
    }
    if (status >= 200 && status < 300) {
      const parsed = parse_body(request, status, response.body);
      if (!parsed) return { kind: "server_error", status };
      const link = next_link(headers.link);
      const next = link === null ? null : relative_link(link, request.host);
      if (link !== null && next === null) console.warn(`[github] GET ${request.host} ${request.path} links its next page outside ${api_base(request.host)}`);
      if (headers.etag) cache.set(cache_key, { etag: headers.etag, body: parsed.value, next, used: request.tally });
      else cache.delete(cache_key);
      return { kind: "ok", body: parsed.value, next };
    }
    if (status === 401) return { kind: "unauthorized" };
    if (status === 403 || status === 429) {
      const until = limit_until(request, response);
      if (until !== null) {
        rates.set(key, { ...(rates.get(key) ?? no_rate), blocked_until: until });
        return { kind: "rate_limited", reset_at: until };
      }
      return { kind: "denied", sso: sso_header_url(headers["x-github-sso"]) };
    }
    if (status >= 500) return { kind: "server_error", status };
    return { kind: "missing", status };
  };

  const send = async (request: GithubRequest): Promise<GithubResult> => {
    const { source, host, path, signal, tally } = request;
    const key = rate_key(source, host);
    const blocked = rates.get(key)?.blocked_until ?? null;
    if (blocked !== null && blocked > now()) return { kind: "rate_limited", reset_at: blocked };
    const cache_key = `${key}\n${path}`;
    const cached = cache.get(cache_key);
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (host_kind_of(host) !== "other") headers["X-GitHub-Api-Version"] = api_version;
    if (cached) headers["If-None-Match"] = cached.etag;
    const sent = await (source.kind === "gh" ? deps.gh : deps.anonymous)({ host, path, headers, signal });
    if (sent.kind !== "response") {
      console.warn(`[github] GET ${host} ${path} through ${identity_of(source)} failed: ${sent.detail}`);
      return sent.kind === "offline" ? { kind: "offline" } : { kind: "unauthorized" };
    }
    const { response } = sent;
    note_rate(key, response.headers);
    if (source.kind === "anonymous" || response.status !== 304) tally.counted += 1;
    const age = max_age_ms(response.headers["cache-control"]);
    if (age !== null) tally.max_age_ms = tally.max_age_ms === null ? age : Math.min(tally.max_age_ms, age);
    const poll = numeric(response.headers["x-poll-interval"]);
    if (poll !== null) tally.poll_ms = Math.max(tally.poll_ms ?? 0, poll * 1000);
    const result = settle(request, key, cache_key, response);
    if (result.kind === "rate_limited" || result.kind === "server_error") {
      console.warn(`[github] GET ${host} ${path} answered ${response.status}, ${rates.get(key)?.remaining ?? "unknown"} requests left`);
    }
    return result;
  };

  const enqueue = <T>(host: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(host) ?? Promise.resolve()).then(work);
    queues.set(host, next.then(settled, settled));
    return next;
  };

  const get = (request: GithubRequest): Promise<GithubResult> =>
    enqueue(request.host, () => {
      if (request.signal.aborted) throw request.signal.reason;
      return send(request);
    });

  return {
    get,
    get_pages: async (request) => {
      const bodies: unknown[] = [];
      const seen = new Set<string>();
      for (let path: string | null = request.path; path !== null && !seen.has(path); ) {
        seen.add(path);
        const result = await get({ ...request, path });
        if (result.kind !== "ok") return result;
        bodies.push(result.body);
        path = result.next;
      }
      return { kind: "ok", bodies };
    },
    rate: (source, host) => rates.get(rate_key(source, host)) ?? no_rate,
    prune: (tally) => {
      for (const [key, entry] of cache) {
        if (entry.used !== tally) cache.delete(key);
      }
    },
  };
};

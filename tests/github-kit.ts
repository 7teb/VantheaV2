import { create_github_client, type GithubClient, type GithubTransport, type RawResponse, type RoundTally, type TransportCall } from "../electron/github/client.ts";

export type Route = RawResponse | ((call: TransportCall) => RawResponse | Promise<RawResponse>);

export const reply = (status: number, body?: unknown, headers: Record<string, string> = {}): RawResponse => ({
  status,
  headers,
  body: body === undefined ? "" : JSON.stringify(body),
});

export const not_found = reply(404, { message: "Not Found" });

export const route_transport =
  (routes: Record<string, Route>, calls: TransportCall[] = []): GithubTransport =>
  async (call) => {
    calls.push(call);
    const route = routes[call.path];
    if (route === undefined) return { kind: "response", response: not_found };
    return { kind: "response", response: typeof route === "function" ? await route(call) : route };
  };

export const fresh_tally = (): RoundTally => ({ counted: 0, max_age_ms: null, poll_ms: null });

export const routed_client = (anonymous: Record<string, Route>, gh: Record<string, Route> = {}, calls: TransportCall[] = []): GithubClient =>
  create_github_client({ anonymous: route_transport(anonymous, calls), gh: route_transport(gh, calls) });

export const sha = (digit: string): string => digit.repeat(40);

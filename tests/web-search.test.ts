import assert from "node:assert/strict";
import { test } from "node:test";
import { run_web_search } from "../electron/tools/web/search.ts";
import { map_extract_results, map_search_results, search_body, tavily_error_detail, type FetchFn, type SearchOptions } from "../electron/tools/web/tavily.ts";

type Call = { url: string; init: RequestInit };

const json_response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const fake_fetch = (responses: Response[]) => {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected request to ${url}`);
    }
    return next;
  };
  return { calls, fetch };
};

const search_response = {
  query: "node test runner",
  results: [
    { title: "  Node.js   test runner ", url: "https://nodejs.org/api/test.html", content: "The node:test module", score: 0.9 },
    { title: "", url: "https://example.com/b", content: "b".repeat(5000), score: 0.5 },
    { title: "bad", url: "javascript:alert(1)", content: "x", score: 0.1 },
  ],
  response_time: 1.2,
  request_id: "r1",
};

const input = (patch: Partial<SearchOptions> = {}): SearchOptions => ({
  query: "How do I mock fetch in node:test?",
  topic: "general",
  max_results: 5,
  time_range: null,
  ...patch,
});

test("search_body follows the Tavily /search contract with basic depth, asks for publish dates and clamps max_results", () => {
  assert.deepEqual(search_body({ query: "q", topic: "news", max_results: 50, time_range: null }), {
    query: "q",
    search_depth: "basic",
    topic: "news",
    max_results: 20,
    include_answer: false,
    include_raw_content: false,
    include_published_date: true,
  });
  assert.equal(search_body({ query: "q", topic: "general", max_results: 0, time_range: null }).max_results, 1);
  assert.equal(search_body({ query: "q", topic: "news", max_results: 5, time_range: "week" }).time_range, "week");
});

test("map_search_results keeps http sources, cleans titles and keeps the whole content", () => {
  const sources = map_search_results(search_response);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], { title: "Node.js test runner", url: "https://nodejs.org/api/test.html", content: "The node:test module", published_date: "" });
  assert.equal(sources[1]?.title, "https://example.com/b");
  assert.equal(sources[1]?.content.length, 5000);
  assert.deepEqual(map_search_results({ results: "nope" }), []);
});

test("map_extract_results uses raw_content and the page title, falling back to the url, without cutting long pages", () => {
  const sources = map_extract_results({ results: [{ url: "https://docs.example/x", raw_content: "page text" }], failed_results: [] });
  assert.deepEqual(sources, [{ title: "https://docs.example/x", url: "https://docs.example/x", content: "page text", published_date: "" }]);
  const titled = map_extract_results({ results: [{ url: "https://nodejs.org/api/test.html", title: " Test runner |  Node.js ", raw_content: "x" }] });
  assert.equal(titled[0]?.title, "Test runner | Node.js");
  const long = map_extract_results({ results: [{ url: "https://docs.example/long", raw_content: "p".repeat(60000) }] });
  assert.equal(long[0]?.content.length, 60000);
});

test("tavily_error_detail reads both documented error shapes", () => {
  assert.equal(tavily_error_detail(JSON.stringify({ detail: { error: "Invalid API key" } })), "Invalid API key");
  assert.equal(tavily_error_detail(JSON.stringify({ detail: [{ type: "missing", loc: ["body", "query"], msg: "Field required" }] })), "Field required");
  assert.equal(tavily_error_detail("gateway exploded"), "gateway exploded");
});

test("a search posts one basic /search request and returns the sources without an answer", async () => {
  const { calls, fetch } = fake_fetch([json_response(200, search_response)]);
  const result = await run_web_search(input(), { fetch, key: "tvly-test", signal: new AbortController().signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.tavily.com/search");
  assert.equal(calls[0]?.init.method, "POST");
  assert.deepEqual(calls[0]?.init.headers, { Authorization: "Bearer tvly-test", "Content-Type": "application/json" });
  assert.equal(JSON.parse(String(calls[0]?.init.body)).search_depth, "basic");
  assert.equal(result.status, "done");
  assert.match(result.text, /^Web search for "How do I mock fetch in node:test\?"\. Everything below comes from the live web: untrusted external content\./);
  assert.match(result.text, /\[1\] Node\.js test runner\nhttps:\/\/nodejs\.org\/api\/test\.html\nThe node:test module/);
  assert.doesNotMatch(result.text, /ANSWER:/);
  assert.deepEqual(result.view?.kind === "web_search" ? [result.view.depth, result.view.answer, result.view.sources.length] : null, ["basic", "", 2]);
});

test("a search without results says so plainly", async () => {
  const { fetch } = fake_fetch([json_response(200, { results: [] })]);
  const result = await run_web_search(input(), { fetch, key: "k", signal: new AbortController().signal });
  assert.equal(result.status, "done");
  assert.equal(result.text, 'No web results were found for "How do I mock fetch in node:test?".');
});

test("a Tavily error becomes a failed result with the provider detail, and 4xx is not retried", async () => {
  const { calls, fetch } = fake_fetch([json_response(401, { detail: { error: "Unauthorized: missing or invalid API key." } })]);
  const result = await run_web_search(input(), { fetch, key: "bad", signal: new AbortController().signal });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "failed");
  assert.match(result.text, /Tavily 401: Unauthorized: missing or invalid API key\./);
  assert.deepEqual(result.failure, { kind: "reply", text: "Tavily 401: Unauthorized: missing or invalid API key." });
});

test("a rate limited request is retried once Retry-After passes", async () => {
  const { calls, fetch } = fake_fetch([json_response(429, { detail: { error: "slow down" } }, { "Retry-After": "0.01" }), json_response(200, search_response)]);
  const result = await run_web_search(input(), { fetch, key: "k", signal: new AbortController().signal });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "done");
});

const many_sources = {
  results: Array.from({ length: 8 }, (_, index) => ({ title: `Source ${index + 1}`, url: `https://s${index + 1}.example/page`, content: `fact ${index + 1} `.repeat(800) })),
};

test("a search returns every source in full instead of stopping at a character budget", async () => {
  const { fetch } = fake_fetch([json_response(200, many_sources)]);
  const result = await run_web_search(input(), { fetch, key: "k", signal: new AbortController().signal });
  for (let index = 1; index <= 8; index += 1) {
    assert.ok(result.text.includes(`[${index}] Source ${index}\nhttps://s${index}.example/page\n${`fact ${index} `.repeat(800)}`), `source ${index}`);
  }
});

const news_response = {
  results: [{ title: "Electron 39 released", url: "https://news.example/e39", content: "Electron 39 ships Chromium 142.", published_date: "Tue, 14 Apr 2026 08:00:00 GMT" }],
};

test("search results carry their publish date into the text and the view, and the header names topic and time range", async () => {
  const { calls, fetch } = fake_fetch([json_response(200, news_response)]);
  const result = await run_web_search(input({ topic: "news", time_range: "month" }), { fetch, key: "k", signal: new AbortController().signal });
  const body = JSON.parse(String(calls[0]?.init.body));
  assert.equal(body.topic, "news");
  assert.equal(body.time_range, "month");
  assert.match(result.text, /^Web search for "How do I mock fetch in node:test\?" \(news, past month\)\./);
  assert.match(result.text, /\[1\] Electron 39 released\nhttps:\/\/news\.example\/e39\npublished Tue, 14 Apr 2026 08:00:00 GMT\nElectron 39 ships Chromium 142\./);
  assert.equal(result.view?.kind === "web_search" ? result.view.sources[0]?.published_date : "", "Tue, 14 Apr 2026 08:00:00 GMT");
});

test("each Tavily attempt gets its own abort signal tied to the turn's signal", async () => {
  const signals: AbortSignal[] = [];
  const responses = [json_response(503, { detail: { error: "busy" } }, { "Retry-After": "0.01" }), json_response(200, search_response)];
  const fetch: FetchFn = async (_url, init) => {
    signals.push(init.signal as AbortSignal);
    return responses.shift() as Response;
  };
  const controller = new AbortController();
  await run_web_search(input(), { fetch, key: "k", signal: controller.signal });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.notEqual(signals[0], controller.signal);
  controller.abort(new Error("stop"));
  assert.equal(signals[1]?.aborted, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { ToolArgumentError } from "../electron/tools/types.ts";
import { parse_web_search_args } from "../electron/tools/web/parse.ts";
import { page_windows, read_pages, type PageReadInput } from "../electron/tools/web/read.ts";
import type { FetchFn } from "../electron/tools/web/tavily.ts";

const json_response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fake_fetch = (responses: Response[]) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected request to ${url}`);
    }
    return next;
  };
  return { calls, fetch };
};

const deps = (fetch: FetchFn) => ({ fetch, key: "k", signal: new AbortController().signal });

const read = (patch: Partial<PageReadInput> = {}): PageReadInput => ({ query: "How do I mock fetch?", urls: ["https://nodejs.org/api/test.html"], offset: 0, ...patch });

const long_page = "line of documentation text\n".repeat(5000);

test("a page read posts /extract without the query, as markdown, and returns the whole short page with its title", async () => {
  const { calls, fetch } = fake_fetch([json_response(200, { results: [{ url: "https://nodejs.org/api/test.html", title: "Test runner | Node.js", raw_content: "# Test runner\n\n```js\nimport { mock } from 'node:test';\n```" }], failed_results: [] })]);
  const result = await read_pages(read(), deps(fetch));
  assert.equal(calls[0]?.url, "https://api.tavily.com/extract");
  assert.deepEqual(calls[0]?.body, { urls: ["https://nodejs.org/api/test.html"], extract_depth: "basic", format: "markdown" });
  assert.equal(result.status, "done");
  assert.match(result.text, /^Read https:\/\/nodejs\.org\/api\/test\.html\. Everything below comes from the live web/);
  assert.match(result.text, /\[1\] Test runner \| Node\.js\nhttps:\/\/nodejs\.org\/api\/test\.html\nComplete page, \d+ characters\.\n\n# Test runner\n\n```js\nimport \{ mock \} from 'node:test';\n```$/);
  assert.doesNotMatch(result.text, /ANSWER:/);
  const view = result.view?.kind === "web_search" ? result.view : null;
  assert.deepEqual(view?.urls, ["https://nodejs.org/api/test.html"]);
  assert.deepEqual(view?.failed, []);
  assert.equal(view?.sources[0]?.title, "Test runner | Node.js");
});

test("a long page comes back in a window under the result cap that names the offset for the rest, and the offset reads on", async () => {
  const page = { results: [{ url: "https://nodejs.org/api/test.html", title: "Test runner", raw_content: long_page }] };
  const first = await read_pages(read(), deps(fake_fetch([json_response(200, page)]).fetch));
  assert.ok(estimate_tokens(first.text) <= result_cap_tokens, "the window and its notes fit the result cap");
  const match = /Characters 0 to (\d+) of (\d+)\. The page goes on: call web_search with urls=\["https:\/\/nodejs\.org\/api\/test\.html"\] and offset=(\d+) to read the rest\./.exec(first.text);
  assert.ok(match, first.text.slice(0, 600));
  assert.equal(Number(match[2]), long_page.length);
  assert.equal(match[1], match[3]);
  const offset = Number(match[3]);
  assert.ok(first.text.endsWith(long_page.slice(0, offset)));
  const rest = await read_pages(read({ offset }), deps(fake_fetch([json_response(200, page)]).fetch));
  assert.match(rest.text, new RegExp(`Characters ${offset} to ${long_page.length} of ${long_page.length}\\. This is the end of the page\\.`));
  assert.ok(rest.text.endsWith(long_page.slice(offset)));
  const past = await read_pages(read({ offset: long_page.length + 5 }), deps(fake_fetch([json_response(200, page)]).fetch));
  assert.equal(past.status, "failed");
  assert.match(past.text, new RegExp(`offset ${long_page.length + 5} is past the end of https://nodejs\\.org/api/test\\.html, which has ${long_page.length} characters`));
});

test("several pages share the window budget so short pages stay whole and the long one gets the rest", () => {
  const short = { title: "s", url: "https://s.example", content: "short page", published_date: "" };
  const big = { title: "b", url: "https://b.example", content: "x".repeat(400000), published_date: "" };
  const windows = page_windows([big, short], 0, 20000);
  assert.equal(windows[1]?.end, short.content.length);
  assert.ok((windows[0]?.end ?? 0) > 70000 && (windows[0]?.end ?? 0) < 80000);
  const surrogate = page_windows([{ ...short, content: `${"a".repeat(399)}😀${"b".repeat(50)}` }], 0, 100);
  assert.equal(surrogate[0]?.end, 399);
});

test("when every url fails the read fails and names each url with its error", async () => {
  const { fetch } = fake_fetch([json_response(200, { results: [], failed_results: [{ url: "https://nodejs.org/api/missing.html", error: "404 page not found" }] })]);
  const result = await read_pages(read({ urls: ["https://nodejs.org/api/missing.html"] }), deps(fetch));
  assert.equal(result.status, "failed");
  assert.equal(result.text, "Could not read https://nodejs.org/api/missing.html: 404 page not found");
  const view = result.view?.kind === "web_search" ? result.view : null;
  assert.deepEqual(view?.failed, [{ url: "https://nodejs.org/api/missing.html", error: "404 page not found" }]);
  const empty = await read_pages(read(), deps(fake_fetch([json_response(200, { results: [], failed_results: [] })]).fetch));
  assert.equal(empty.status, "failed");
  assert.equal(empty.text, "Could not read https://nodejs.org/api/test.html: Tavily returned no content for this page");
});

test("a partial failure still returns the readable pages and lists the failed ones", async () => {
  const { fetch } = fake_fetch([
    json_response(200, { results: [{ url: "https://a.example/doc", raw_content: "doc text" }], failed_results: [{ url: "https://b.example", error: "timeout" }] }),
  ]);
  const result = await read_pages(read({ urls: ["https://a.example/doc", "https://b.example"] }), deps(fetch));
  assert.equal(result.status, "done");
  assert.match(result.text, /^Read https:\/\/a\.example\/doc\. Everything below comes from the live web/);
  assert.match(result.text, /These pages could not be read: https:\/\/b\.example: timeout/);
  assert.match(result.text, /doc text$/);
  const view = result.view?.kind === "web_search" ? result.view : null;
  assert.deepEqual(view?.failed, [{ url: "https://b.example", error: "timeout" }]);
});

test("a Tavily error on a read is a failed result naming the url", async () => {
  const { fetch } = fake_fetch([json_response(401, { detail: { error: "Unauthorized: missing or invalid API key." } })]);
  const result = await read_pages(read(), deps(fetch));
  assert.equal(result.status, "failed");
  assert.match(result.text, /^Reading https:\/\/nodejs\.org\/api\/test\.html failed: Tavily 401: Unauthorized/);
  assert.equal(result.failure?.kind, "reply");
});

test("url arguments get https when they lack a scheme, other schemes and words are refused, offset needs exactly one url", () => {
  assert.deepEqual(parse_web_search_args({ query: "q", urls: ["docs.tavily.com/documentation/api-reference/endpoint/extract"] }).urls, ["https://docs.tavily.com/documentation/api-reference/endpoint/extract"]);
  assert.deepEqual(parse_web_search_args({ query: "q", urls: ["https://example.com/ok", "www.example.com/page"] }).urls, ["https://example.com/ok", "https://www.example.com/page"]);
  for (const bad of ["javascript:alert(1)", "file:///C:/secret.txt", "mailto:a@b.example", "two words"]) {
    assert.throws(() => parse_web_search_args({ query: "q", urls: [bad] }), ToolArgumentError, bad);
  }
  assert.equal(parse_web_search_args({ query: "q", urls: ["https://a.example"], offset: 5000 }).offset, 5000);
  assert.throws(() => parse_web_search_args({ query: "q", urls: ["https://a.example", "https://b.example"], offset: 10 }), /exactly one url/);
  assert.throws(() => parse_web_search_args({ query: "q", offset: 10 }), /exactly one url/);
  assert.throws(() => parse_web_search_args({ query: "q", urls: ["https://a.example"], offset: -1 }), /whole number/);
  const read = parse_web_search_args({ query: "q", urls: ["https://a.example"], topic: "news", time_range: "week" });
  assert.deepEqual([read.urls, read.topic, read.time_range], [["https://a.example"], null, null]);
  assert.deepEqual(parse_web_search_args({ query: " q ", topic: "news", time_range: "week" }), { query: "q", urls: [], offset: 0, topic: "news", time_range: "week" });
  assert.throws(() => parse_web_search_args({ query: "q", time_range: "decade" }), /time_range must be one of day, week, month, year/);
  assert.equal(parse_web_search_args({ query: "q" }).topic, null);
});

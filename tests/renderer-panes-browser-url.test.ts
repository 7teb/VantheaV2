import assert from "node:assert/strict";
import { test } from "node:test";
import { display_browser_url, normalize_browser_url, tab_label } from "../src/features/docks/browser/browser-url.ts";

const cases: [string, string | null][] = [
  ["example.com", "https://example.com"],
  ["https://a.de/x?y=1", "https://a.de/x?y=1"],
  ["http://a.de", "http://a.de"],
  ["localhost:5173", "http://localhost:5173"],
  ["localhost", "http://localhost"],
  ["127.0.0.1:3000", "http://127.0.0.1:3000"],
  ["[::1]:5173", "http://[::1]:5173"],
  ["https://localhost:5173", "https://localhost:5173"],
  ["example.com:8080/pfad", "https://example.com:8080/pfad"],
  ["192.168.1.10:3000", "https://192.168.1.10:3000"],
  ["javascript:alert(1)", null],
  ["file:///C:/", null],
  ["data:text/html,x", null],
  ["chrome://settings", null],
  ["ws://x", null],
  ["https://", null],
  ["", null],
  ["   ", null],
  ["  example.com  ", "https://example.com"],
  ["about:blank", "about:blank"],
];

test("normalize_browser_url keeps http and https, adds schemes, and refuses other protocols", () => {
  for (const [input, expected] of cases) {
    assert.equal(normalize_browser_url(input), expected, input);
  }
});

test("free text becomes a DuckDuckGo search", () => {
  assert.equal(normalize_browser_url("wie spaet ist es"), "https://duckduckgo.com/?q=wie%20spaet%20ist%20es");
  assert.equal(normalize_browser_url("vantheax"), "https://duckduckgo.com/?q=vantheax");
});

test("display_browser_url hides about:blank and keeps everything else", () => {
  assert.equal(display_browser_url("about:blank"), "");
  assert.equal(display_browser_url("https://x.de"), "https://x.de");
});

test("tab_label prefers the page title, then the host, then the fallback", () => {
  assert.equal(tab_label("  Docs  ", "https://x.de/a", "New tab"), "Docs");
  assert.equal(tab_label("", "https://x.de:8080/a", "New tab"), "x.de:8080");
  assert.equal(tab_label("", "about:blank", "New tab"), "New tab");
  assert.equal(tab_label("", "not a url", "New tab"), "New tab");
});

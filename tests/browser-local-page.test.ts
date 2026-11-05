import assert from "node:assert/strict";
import { test } from "node:test";
import { crosses_into_files, is_guest_url_allowed, normalize_browser_page, normalize_browser_target } from "../electron/browser/guest-policy.ts";
import { is_local_page, local_page_name, local_page_path, local_page_url } from "../shared/local-page.ts";
import { display_browser_url, normalize_browser_url, tab_label } from "../src/features/docks/browser/browser-url.ts";

test("an absolute Windows path or a file URL of an html page becomes a file URL", () => {
  assert.equal(local_page_url("C:\\Users\\max un\\site\\index.html"), "file:///C:/Users/max%20un/site/index.html");
  assert.equal(local_page_url("c:/Temp/scratchpad/book-compare.html"), "file:///C:/Temp/scratchpad/book-compare.html");
  assert.equal(local_page_url("C:/a/#draft/page.htm"), "file:///C:/a/%23draft/page.htm");
  assert.equal(local_page_url("file:///D:/site/logo.svg"), "file:///D:/site/logo.svg");
  assert.equal(local_page_url("  D:\\docs\\page.xhtml  "), "file:///D:/docs/page.xhtml");
});

test("only html, xhtml and svg files on a local drive open, never secret files or network paths", () => {
  assert.equal(local_page_url("C:/notes/todo.txt"), null);
  assert.equal(local_page_url("C:/Users/max/.ssh/known.html"), null);
  assert.equal(local_page_url("C:/app/.env.html"), null);
  assert.equal(local_page_url("C:/folder/"), null);
  assert.equal(local_page_url("file://server/share/page.html"), null);
  assert.equal(local_page_url("file:///C:/a/page.html.:x"), null);
  assert.equal(is_local_page("file:///C:/a/%zz.html"), false);
});

test("the guest policy lets local pages load and refuses a web page that tries to reach one", () => {
  assert.equal(is_guest_url_allowed("file:///C:/site/index.html", false), true);
  assert.equal(is_guest_url_allowed("file:///C:/site/data.json", false), false);
  assert.equal(is_guest_url_allowed("https://example.com", false), true);
  assert.equal(crosses_into_files("https://example.com/", "file:///C:/site/index.html"), true);
  assert.equal(crosses_into_files("file:///C:/site/index.html", "file:///C:/site/other.html"), false);
  assert.equal(crosses_into_files("about:blank", "https://example.com"), false);
});

test("the browser tools take local paths, while web targets keep their old handling", () => {
  assert.equal(normalize_browser_page("C:\\site\\index.html"), "file:///C:/site/index.html");
  assert.equal(normalize_browser_page("C:\\site\\notes.md"), null);
  assert.equal(normalize_browser_page("localhost:5173"), "http://localhost:5173");
  assert.equal(normalize_browser_page("example.com"), normalize_browser_target("example.com"));
  assert.equal(normalize_browser_target("C:\\site\\index.html"), null);
});

test("the address bar opens a typed path and shows the page by its path and file name", () => {
  const url = normalize_browser_url("C:\\Users\\max\\page one.html");
  assert.equal(url, "file:///C:/Users/max/page%20one.html");
  assert.equal(display_browser_url(url ?? ""), "C:/Users/max/page one.html");
  assert.equal(tab_label("", url ?? "", "New tab"), "page one.html");
  assert.equal(normalize_browser_url("C:\\Users\\max\\secret.key"), null);
  assert.equal(local_page_path("https://example.com"), null);
  assert.equal(local_page_name("file:///C:/a/b/c.svg"), "c.svg");
});

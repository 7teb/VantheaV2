import assert from "node:assert/strict";
import { test } from "node:test";
import { chat_partition, draft_partition, is_guest_url_allowed, normalize_browser_target, plain_user_agent } from "../electron/browser/guest-policy.ts";

const real = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VantheaX/0.2.0 Chrome/142.0.7444.265 Electron/39.8.10 Safari/537.36";
const plain = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.265 Safari/537.36";

test("user agent loses the app and Electron tokens and keeps Chrome and Safari", () => {
  assert.equal(plain_user_agent(real, "VantheaX"), plain);
  assert.equal(plain_user_agent(plain, "VantheaX"), plain);
  assert.equal(plain_user_agent("", "VantheaX"), "");
});

test("user agent stripping escapes regex characters in the app name", () => {
  assert.equal(plain_user_agent("Mozilla/5.0 (X) Some.App/2.0 Chrome/1.2.3 Electron/9.9.9 Safari/537.36", "Some.App"), "Mozilla/5.0 (X) Chrome/1.2.3 Safari/537.36");
  assert.equal(plain_user_agent("Mozilla/5.0 (X) SomeXApp/2.0 Chrome/1.2.3 Safari/537.36", "Some.App"), "Mozilla/5.0 (X) SomeXApp/2.0 Chrome/1.2.3 Safari/537.36");
});

test("without an app name only the Electron token is removed", () => {
  assert.equal(plain_user_agent(real, ""), plain.replace("(KHTML, like Gecko) ", "(KHTML, like Gecko) VantheaX/0.2.0 "));
});

test("browser partitions are per chat or per draft and keep nothing on disk", () => {
  const names = [chat_partition("chat-a"), chat_partition("chat-b"), chat_partition("persist:x"), draft_partition(1), draft_partition(2)];
  assert.deepEqual(names, ["vx-browser-chat-chat-a", "vx-browser-chat-chat-b", "vx-browser-chat-persist:x", "vx-browser-draft-1", "vx-browser-draft-2"]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.some((name) => name.startsWith("persist:")), false);
});

test("guest urls are limited to http and https, about:blank only where allowed", () => {
  assert.equal(is_guest_url_allowed("https://example.com/a", false), true);
  assert.equal(is_guest_url_allowed("http://localhost:3000", false), true);
  assert.equal(is_guest_url_allowed("about:blank", false), false);
  assert.equal(is_guest_url_allowed("about:blank", true), true);
  assert.equal(is_guest_url_allowed("file:///C:/Windows/win.ini", true), false);
  assert.equal(is_guest_url_allowed("javascript:alert(1)", true), false);
  assert.equal(is_guest_url_allowed("not a url", true), false);
});

test("navigation targets are normalized to http and https", () => {
  assert.equal(normalize_browser_target("example.com"), "https://example.com");
  assert.equal(normalize_browser_target("localhost:48765"), "http://localhost:48765");
  assert.equal(normalize_browser_target("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
  assert.equal(normalize_browser_target("example.com:8443"), "https://example.com:8443");
  assert.equal(normalize_browser_target("browser agent test"), "https://duckduckgo.com/?q=browser%20agent%20test");
  assert.equal(normalize_browser_target("about:blank"), "about:blank");
  assert.equal(normalize_browser_target("file:///C:/Windows/win.ini"), null);
  assert.equal(normalize_browser_target("javascript:alert(1)"), null);
  assert.equal(normalize_browser_target("   "), null);
});

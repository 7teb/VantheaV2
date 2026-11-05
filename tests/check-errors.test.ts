import assert from "node:assert/strict";
import { test } from "node:test";
import { count_repeats, page_error } from "../electron/check/errors.ts";

test("uncaught exceptions name the file and the 1-based line and keep the first line of the description", () => {
  const params = { exceptionDetails: { url: "vx-check://abc/app.js", lineNumber: 41, text: "Uncaught", exception: { description: "TypeError: Cannot read properties of null (reading 'getContext')\n    at init (app.js:42:10)" } } };
  assert.equal(page_error("Runtime.exceptionThrown", params), "exception app.js:42 TypeError: Cannot read properties of null (reading 'getContext')");
  assert.equal(page_error("Runtime.exceptionThrown", { exceptionDetails: { lineNumber: 0, text: "Uncaught SyntaxError" } }), "exception  Uncaught SyntaxError");
  assert.equal(page_error("Runtime.exceptionThrown", { exceptionDetails: { url: "vx-check://abc/index.html", lineNumber: 3, text: "x".repeat(400) } })?.length, 240);
});

test("console.error joins values and descriptions, drops font noise and caps at 220 characters", () => {
  assert.equal(page_error("Runtime.consoleAPICalled", { type: "error", args: [{ value: "bad" }, { value: 3 }, { description: "Error: boom" }, { value: null }] }), "console.error bad 3 Error: boom null");
  assert.equal(page_error("Runtime.consoleAPICalled", { type: "log", args: [{ value: "fine" }] }), null);
  assert.equal(page_error("Runtime.consoleAPICalled", { type: "error", args: [{ value: "GET https://fonts.gstatic.com/x.woff2 net::ERR_NAME_NOT_RESOLVED" }] }), null);
  assert.equal(page_error("Runtime.consoleAPICalled", { type: "error", args: [{ value: "y".repeat(300) }] }), `console.error ${"y".repeat(220)}`);
});

test("log errors keep the file name, skip offline font noise and the requests check_page blocked itself", () => {
  assert.equal(page_error("Log.entryAdded", { entry: { level: "error", text: "Failed to load resource: the server responded with a status of 404 ()", url: "vx-check://abc/img/missing.png" } }), "log Failed to load resource: the server responded with a status of 404 () missing.png");
  assert.equal(page_error("Log.entryAdded", { entry: { level: "warning", text: "slow", url: "" } }), null);
  assert.equal(page_error("Log.entryAdded", { entry: { level: "error", text: "Failed to load resource: net::ERR_INTERNET_DISCONNECTED", url: "https://fonts.googleapis.com/css2" } }), null);
  assert.equal(page_error("Log.entryAdded", { entry: { level: "error", text: "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT", url: "https://cdn.example.com/lib.js" } }), null);
  assert.equal(page_error("Page.frameNavigated", {}), null);
  assert.equal(page_error("Runtime.exceptionThrown", "not an object"), "exception  ");
});

test("repeated errors collapse to the first occurrence with (xN), in first-seen order", () => {
  assert.deepEqual(count_repeats(["a", "b", "a", "c", "a", "b"]), ["a  (x3)", "b  (x2)", "c"]);
  assert.deepEqual(count_repeats([]), []);
});

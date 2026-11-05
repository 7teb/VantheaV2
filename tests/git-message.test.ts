import assert from "node:assert/strict";
import { test } from "node:test";
import { reflow_message } from "../shared/git/message.ts";

test("lines of one paragraph become one line and blank lines between paragraphs stay", () => {
  assert.equal(reflow_message("Keep the tool rows\ninside the chat column\nand stop the jump.\n\nSecond paragraph\nwrapped here."), "Keep the tool rows inside the chat column and stop the jump.\n\nSecond paragraph wrapped here.");
});

test("list items, numbered items, # lines and indented lines keep their own line", () => {
  const message = ["Changes:", "- first item", "- second item", "  continued under it", "* star item", "1. numbered", "2. numbered again", "# Conflicts:", "#\tsrc/a.ts", "    code line", "plain after code", "joined"].join("\n");
  assert.equal(
    reflow_message(message),
    ["Changes:", "- first item", "- second item", "  continued under it", "* star item", "1. numbered", "2. numbered again", "# Conflicts:", "#\tsrc/a.ts", "    code line", "plain after code joined"].join("\n"),
  );
});

test("CRLF and lone CR line ends are read as line breaks", () => {
  assert.equal(reflow_message("one\r\ntwo\r\n\r\nthree\rfour"), "one two\n\nthree four");
});

test("a single line and an empty message stay as they are", () => {
  assert.equal(reflow_message("Fix the build"), "Fix the build");
  assert.equal(reflow_message(""), "");
});

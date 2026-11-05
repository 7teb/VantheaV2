import assert from "node:assert/strict";
import { test } from "node:test";
import { clean_git_text, commit_message_system, pr_text_system, split_pr_text } from "../electron/side/git-text.ts";

test("both prompts forbid trailers and any tool, assistant or model name", () => {
  assert.match(commit_message_system, /Never add a trailer, a sign-off, a co-author line/);
  assert.match(commit_message_system, /the name of any tool, assistant or model/);
  assert.match(commit_message_system, /no code fence/);
  assert.match(pr_text_system, /Never mention any tool, assistant or model and add no generated-by line/);
  assert.match(pr_text_system, /Do not invent tests, issues, screenshots or links/);
});

test("clean_git_text strips one outer code fence and the surrounding whitespace", () => {
  assert.equal(clean_git_text("```\nFix the login\n\nBody line\n```"), "Fix the login\n\nBody line");
  assert.equal(clean_git_text("```text\nFix it\n```\n"), "Fix it");
  assert.equal(clean_git_text("  Fix it  \n"), "Fix it");
  assert.equal(clean_git_text("Fix it\n\n```js\ncode\n```"), "Fix it\n\n```js\ncode\n```");
});

test("split_pr_text takes the first line as title without a heading mark or Title prefix", () => {
  assert.deepEqual(split_pr_text("# Add the commit box\n\nBody text\n- one"), { title: "Add the commit box", body: "Body text\n- one" });
  assert.deepEqual(split_pr_text("Title: Push from the panel\n\nWhy"), { title: "Push from the panel", body: "Why" });
  assert.deepEqual(split_pr_text("\n\nOnly a title"), { title: "Only a title", body: "" });
  assert.deepEqual(split_pr_text("```markdown\n## Fenced title\n\nBody\n```"), { title: "Fenced title", body: "Body" });
  assert.deepEqual(split_pr_text("   "), { title: "", body: "" });
});

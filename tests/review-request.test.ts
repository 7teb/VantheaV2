import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { reviewer_brief, review_request_text } from "../electron/turn/review-request.ts";

const model: ModelEntry = {
  id: "vendor/model",
  label: "Model",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 1_048_576,
  max_output: 65_536,
  reasoning_passback: false,
};

const changes = review_request_text(null, model);

const pull_request = review_request_text("42", model);

test("a review of the current changes collects git material and a pull request review collects it with gh", () => {
  assert.match(changes, /^Review the current changes of this project: uncommitted changes and the commits of the current branch against its base with one independent reviewer/);
  assert.match(changes, /git status --short/);
  assert.match(changes, /git symbolic-ref --short refs\/remotes\/origin\/HEAD, else origin\/main or origin\/master/);
  assert.match(changes, /git diff HEAD, and when HEAD is not on the base also git log --oneline <base>\.\.HEAD and git diff <base>\.\.\.HEAD/);
  assert.doesNotMatch(changes, /gh pr/);
  assert.match(pull_request, /^Review pull request #42 with one independent reviewer/);
  assert.match(pull_request, /gh pr view 42 --json number,title,body,url,baseRefName,headRefName,author,files and gh pr diff 42\./);
  assert.match(pull_request, /install it from https:\/\/cli\.github\.com and run gh auth login/);
  assert.doesNotMatch(pull_request, /git status --short/);
});

test("the request forbids edits, commits, pushes and GitHub comments and deploys exactly one explore reviewer", () => {
  for (const text of [changes, pull_request]) {
    assert.match(text, /Do not edit, stage, commit, push, check out, or comment on GitHub\./);
    assert.match(text, /Deploy exactly one agent with deploy_agent: name "Reviewer", topic "review", profile "explore", no scope, your own model and effort\./);
    assert.match(text, /Do not review the changes yourself while it runs\./);
    assert.match(text, /keep a finding only when the code shows the failure the reviewer describes/);
    assert.match(text, /End with one line saying how many of the reviewer's findings you dropped\./);
    assert.doesNotMatch(text, /[–—]/);
  }
});

test("the reviewer brief closes the request word for word", () => {
  for (const text of [changes, pull_request]) {
    assert.ok(text.endsWith(`\n\nREVIEWER BRIEF\n\n${reviewer_brief}`));
  }
  assert.match(reviewer_brief, /^You review a set of code changes for defects that hurt the project/);
  assert.match(reviewer_brief, /For a pull request the project files may be on another branch: the diff is the authority for the new code, the files are context only\./);
  assert.match(reviewer_brief, /Do not edit anything\.$/);
  assert.doesNotMatch(reviewer_brief, /[–—]/);
});

test("the diff goes in whole and the size rule names the reviewer's real window, compaction point and output limit", () => {
  assert.match(changes, /Put in the whole diff\. The reviewer runs on your model: its context window is 1,048,576 tokens, and the app compacts its conversation once it reaches 734,003 tokens/);
  assert.match(changes, /one response of yours \(at most 65,536 tokens of output\)/);
  assert.match(changes, /name the files left out, so the reviewer reads them from the project files/);
  assert.match(changes, /Each tool result is cut at 25,000 tokens, so collect a larger diff in parts/);
  assert.doesNotMatch(changes, /100,?000 characters/);
  const limited = review_request_text(null, { ...model, context_length: 200_000, compact_at: 0.5, max_output: 8192 });
  assert.match(limited, /its context window is 200,000 tokens, and the app compacts its conversation once it reaches 100,000 tokens/);
  assert.match(limited, /at most 8,192 tokens of output/);
});

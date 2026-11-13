import assert from "node:assert/strict";
import { test } from "node:test";
import { fit_phrases, group_phrases, joined_phrases } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const measure = (text: string) => text.length * 7;

const phrases = ["updated todos", "deployed agents", "read files", "used the browser", "searched the web", "ran commands"];

const more = en("tools.combine_more");

test("a group label that fits shows every phrase and no tail", () => {
  const full = joined_phrases(phrases);
  assert.equal(full, "Updated todos, deployed agents, read files, used the browser, searched the web, ran commands");
  assert.equal(fit_phrases(phrases, more, measure(full), measure), full);
  assert.equal(fit_phrases(["read files"], more, 10, measure), "Read files");
});

test("a group label that does not fit keeps as many phrases as fit and ends with ran additional tools", () => {
  const four = "Updated todos, deployed agents, read files, used the browser, ran additional tools";
  assert.equal(more, "ran additional tools");
  assert.equal(fit_phrases(phrases, more, measure(four), measure), four);
  assert.equal(fit_phrases(phrases, more, measure(four) - 1, measure), "Updated todos, deployed agents, read files, ran additional tools");
  assert.equal(fit_phrases(phrases, more, 40, measure), "Updated todos, ran additional tools");
  assert.equal(fit_phrases(["ran commands", "read files"], more, 40, measure), "Ran commands, read files");
  assert.equal(translate("de", "tools.combine_more"), "weitere Tools ausgeführt");
});

test("the phrases of a group are the same words the joined label shows", () => {
  const step = (id: string, name: string, args: Record<string, unknown>) =>
    ({ id, round: 1, kind: "tool", index: 0, call_id: id, name, args, status: "done", progress: null, approval: null, view: null, error: null, result_text: "", started_at: 0, ended_at: 1 }) as never;
  const steps = [step("a", "run_command", { command: "npm test" }), step("b", "read_file", { path: "a.ts" }), step("c", "read_file", { path: "b.ts" })];
  assert.deepEqual(group_phrases(en, steps), ["ran a command", "read files"]);
  assert.equal(joined_phrases(group_phrases(en, steps)), "Ran a command, read files");
});

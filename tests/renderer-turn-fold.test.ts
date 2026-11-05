import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { agents, ago, append, at, deployed, expanded, head_text, language, long_turn, mounted, notice, press, reasoning, setup, show, teardown, text, toggle, tool, turn, visible, with_class } from "./turn-fold-harness.ts";

before(setup);

after(teardown);

test("a running turn gets the Working header with its line from the first activity item, not before", () => {
  show("c_run", turn("a_run", "streaming", [text("t1", "Let me look")], ago(0)));
  assert.equal(head_text(), null);
  assert.equal(with_class("turn-head-rule").length, 0);
  show("c_run", turn("a_run", "streaming", [text("t1", "Let me look"), tool("a1", "read_file", 1)], ago(0)));
  assert.equal(head_text(), "Working");
  assert.equal(with_class("turn-head-rule").length, 1);
  assert.equal(toggle(), null);
  show("c_run", null);
  show("c_run", turn("a_run", "streaming", [reasoning("r1", null)], ago(5_400)));
  assert.equal(head_text(), "Working for 5s");
  assert.deepEqual(visible(), ["reasoning"]);
  show("c_run", null);
});

test("a turn with only answer text gets no header and no line, running or done", () => {
  show("c_plain", turn("a_plain", "streaming", [text("t1", "Hello")]));
  assert.equal(head_text(), null);
  show("c_plain", turn("a_plain", "done", [text("t1", "Hello")]));
  assert.equal(head_text(), null);
  assert.equal(with_class("turn-head-rule").length, 0);
  assert.deepEqual(visible(), ["text", "file_changes"]);
  show("c_plain", null);
});

test("a finished done turn folds everything up to the last activity step and keeps answer, images, plan, steers and file changes", () => {
  show("c_fold", turn("a_fold", "streaming", long_turn()));
  assert.deepEqual(visible(), ["reasoning", "text", "work", "steer", "work", "notice", "image", "plan", "text"]);
  show("c_fold", turn("a_fold", "done", long_turn()));
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 10s");
  assert.equal(with_class("turn-head-rule").length, 1);
  assert.deepEqual(visible(), ["steer", "image", "plan", "text", "file_changes"]);
  assert.equal(with_class("assistant-actions").length, 1);
  assert.ok(with_class("turn-fold-item").filter((item) => item.getAttribute("data-folded") === "true").every((item) => item.hasAttribute("inert")));
  press(toggle()!);
  assert.equal(expanded(), "true");
  assert.deepEqual(visible(), ["reasoning", "text", "work", "steer", "work", "notice", "image", "plan", "text", "file_changes"]);
  show("c_fold", null);
});

test("reasoning and tools of one stretch share one work block, while streaming and folded behind Worked for", () => {
  const steps = [reasoning("r1", 2_000), tool("a1", "read_file", 4_000), reasoning("r2", 6_000), tool("a2", "grep_files", 8_000), text("t1", "Found it.")];
  show("c_mixed", turn("a_mixed", "streaming", [reasoning("r1", null)], ago(1_000)));
  assert.deepEqual(visible(), ["reasoning"]);
  show("c_mixed", turn("a_mixed", "streaming", [reasoning("r1", 2_000), tool("a1", "read_file", null)], ago(1_000)));
  assert.deepEqual(visible(), ["work"]);
  show("c_mixed", turn("a_mixed", "streaming", steps.slice(0, 4), ago(1_000)));
  assert.deepEqual(visible(), ["work"]);
  show("c_mixed", null);
  show("c_mixed", turn("a_mixed", "done", steps));
  assert.equal(head_text(), "Worked for 8s");
  assert.deepEqual(visible(), ["text", "file_changes"]);
  press(toggle()!);
  assert.deepEqual(visible(), ["work", "text", "file_changes"]);
  show("c_mixed", null);
});

test("a finished turn loaded from disk starts folded without mounting the folded rows, and expanding shows everything", () => {
  show("c_load", turn("a_load", "done", long_turn()));
  assert.deepEqual(mounted(), ["steer", "image", "plan", "text", "file_changes"]);
  press(toggle()!);
  assert.deepEqual(visible(), ["reasoning", "text", "work", "steer", "work", "notice", "image", "plan", "text", "file_changes"]);
  show("c_load", null);
});

test("a done turn that ends on an activity step keeps everything open under a static Worked for header", () => {
  show("c_tail", turn("a_tail", "done", [reasoning("r1", 2_000), text("t1", "Reading"), tool("a1", "read_file", 6_000)]));
  assert.equal(toggle(), null);
  assert.equal(head_text(), "Worked for 6s");
  assert.deepEqual(visible(), ["reasoning", "text", "work", "file_changes"]);
  show("c_tail", null);
});

test("stopped, interrupted and failed turns never fold and carry their own header", () => {
  show("c_status", turn("a_stopped", "stopped", long_turn(), at(0), at(12_700)));
  assert.equal(toggle(), null);
  assert.equal(head_text(), "You stopped after 12s");
  assert.equal(with_class("assistant-note").length, 0);
  assert.equal(visible().length, 10);
  show("c_status", turn("a_interrupted", "interrupted", long_turn()));
  assert.equal(toggle(), null);
  assert.equal(head_text(), "Activity");
  assert.equal(with_class("interrupted-row").length, 1);
  assert.equal(visible().length, 10);
  show("c_status", turn("a_failed", "failed", long_turn()));
  assert.equal(toggle(), null);
  assert.equal(head_text(), "Worked for 10s");
  assert.equal(with_class("error-card").length, 1);
  assert.equal(visible().length, 10);
  show("c_status", turn("a_stopped_plain", "stopped", [text("t1", "Partial")]));
  assert.equal(toggle(), null);
  assert.equal(head_text(), "You stopped after 30s");
  assert.equal(with_class("assistant-note").length, 0);
  assert.deepEqual(visible(), ["text", "file_changes"]);
  show("c_status", null);
});

test("a done turn counts as working while an agent it deployed runs, with no toggle, and folds when the run ends", () => {
  const ready = (status: "running" | "completed") => agents("c_agents", "ready", status);
  ready("running");
  show("c_agents", turn("a_agents", "done", deployed("a")));
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  assert.deepEqual(visible(), ["work", "text"]);
  ready("completed");
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 2s");
  assert.deepEqual(visible(), ["text", "file_changes"]);
  press(toggle()!);
  assert.equal(expanded(), "true");
  show("c_agents", null);
});

test("an opened turn stays open across a remount and folds again when the user sends the next message", () => {
  show("c_keep", turn("a_keep", "done", long_turn()));
  press(toggle()!);
  show("c_keep", null);
  show("c_keep", turn("a_keep", "done", long_turn()));
  assert.equal(expanded(), "true");
  append("c_keep", "background");
  assert.equal(expanded(), "true");
  append("c_other", "user");
  assert.equal(expanded(), "true");
  append("c_keep", "user");
  assert.equal(expanded(), "false");
  assert.deepEqual(visible(), ["steer", "image", "plan", "text", "file_changes"]);
  show("c_keep", null);
});

test("the duration runs from created_at to the end of the last activity step, floored, falling back to ended_at", () => {
  show("c_time", turn("a_time", "done", [reasoning("r1", 3_400), tool("a1", "read_file", 12_900), text("t1", "Done.")], at(0), at(30_000)));
  assert.equal(head_text(), "Worked for 12s");
  show("c_time", turn("a_time_2", "done", [notice("n1"), text("t1", "Done.")], at(0), at(7_600)));
  assert.equal(head_text(), "Worked for 7s");
  show("c_time", turn("a_time_3", "done", [tool("a1", "read_file", 125_000), text("t1", "Done.")], at(0), at(130_000)));
  assert.equal(head_text(), "Worked for 2m 5s");
  language("de");
  assert.equal(head_text(), "Dauer: 2m 5s");
  show("c_time", turn("a_time_4", "stopped", [tool("a1", "read_file", 3_000)], at(0), at(8_200)));
  assert.equal(head_text(), "Du hast nach 8s gestoppt");
  show("c_time", turn("a_time_5", "interrupted", [tool("a1", "read_file", 3_000)]));
  assert.equal(head_text(), "Aktivität");
  show("c_time", turn("a_time_6", "streaming", [tool("a1", "read_file", 3_000)], ago(0)));
  assert.equal(head_text(), "In Bearbeitung");
  show("c_time", null);
  show("c_time", turn("a_time_6", "streaming", [tool("a1", "read_file", 3_000)], ago(3_200)));
  assert.equal(head_text(), "In Bearbeitung seit 3s");
  language("en");
  show("c_time", null);
});

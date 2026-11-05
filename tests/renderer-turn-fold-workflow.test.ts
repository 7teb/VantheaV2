import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { expanded, head_text, ran_workflow, setup, show, teardown, toggle, turn, visible, workflow } from "./turn-fold-harness.ts";

before(setup);

after(teardown);

test("a done turn keeps working while the workflow it started runs and folds when the workflow ends", () => {
  workflow("c_wf", "wf_hold", "running");
  show("c_wf", turn("a_wf", "done", ran_workflow("a", "wf_hold")));
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  assert.deepEqual(visible(), ["work", "text"]);
  workflow("c_wf", "wf_hold", "completed");
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 2s");
  assert.deepEqual(visible(), ["text", "file_changes"]);
  show("c_wf", null);
});

test("a stopped, interrupted or unknown workflow does not hold the turn", () => {
  for (const status of ["stopped", "interrupted", "failed"] as const) {
    workflow("c_wf", "wf_end", status);
    show("c_wf", turn("a_end", "done", ran_workflow("b", "wf_end")));
    assert.equal(head_text(), "Worked for 2s", status);
    show("c_wf", null);
  }
  workflow("c_wf", "wf_other", "running");
  show("c_wf", turn("a_unknown", "done", ran_workflow("c", "wf_missing")));
  assert.equal(head_text(), "Worked for 2s");
  show("c_wf", null);
});

test("right after switching back to its chat the turn keeps working from the remembered status while the list loads", () => {
  workflow("c_back", "wf_back", "running", "loading");
  show("c_back", turn("a_back", "done", ran_workflow("d", "wf_back")));
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  workflow("c_back", "wf_back", "completed", "loading");
  assert.equal(head_text(), "Worked for 2s");
  show("c_back", null);
});

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Step } from "../shared/chat.ts";
import {
  agents,
  ago,
  append,
  at,
  deployed,
  expanded,
  head_text,
  image_view,
  notice,
  open_chat,
  plan_view,
  press,
  reasoning,
  setup,
  show,
  teardown,
  text,
  toggle,
  tool,
  turn,
  visible,
  with_class,
} from "./turn-fold-harness.ts";

before(setup);

after(teardown);

test("a plan turn folds its investigation behind the toggle and keeps the plan card visible", () => {
  show("c_plan", turn("a_plan", "done", [reasoning("r1", 1_000), tool("rd", "read_file", 4_000), tool("pl", "present_plan", 6_000, plan_view)]));
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 6s");
  assert.deepEqual(visible(), ["plan", "file_changes"]);
  press(toggle()!);
  assert.deepEqual(visible(), ["work", "plan", "file_changes"]);
  show("c_plan", turn("a_image", "done", [reasoning("r1", 2_000), tool("img", "generate_image", 20_000, image_view)]));
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 20s");
  assert.deepEqual(visible(), ["image", "file_changes"]);
  show("c_plan", null);
});

test("the header stays while a running image tool turns into the image and after the turn ends", () => {
  show("c_img", turn("a_img", "streaming", [tool("img", "generate_image", null)], ago(4_200)));
  assert.equal(head_text(), "Working for 4s");
  show("c_img", turn("a_img", "streaming", [tool("img", "generate_image", 20_000, image_view)], ago(4_200)));
  assert.equal(head_text(), "Working for 4s");
  show("c_img", turn("a_img", "done", [tool("img", "generate_image", 20_000, image_view), text("t1", "Here is the fox")]));
  assert.equal(head_text(), "Worked for 20s");
  assert.equal(toggle(), null);
  assert.deepEqual(visible(), ["image", "text", "file_changes"]);
  show("c_img", null);
});

test("blank reasoning gets no header, and a retry that drops the reasoning keeps the running header", (t) => {
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const created_at = ago(2_000);
  show("c_blank", turn("a_blank", "streaming", [reasoning("r1", null, "\n")], created_at));
  assert.equal(head_text(), null);
  show("c_blank", turn("a_blank", "streaming", [text("t1", "Hello")], created_at));
  assert.equal(head_text(), null);
  show("c_blank", null);
  show("c_retry", turn("a_retry", "streaming", [reasoning("r1", null)], created_at));
  assert.equal(head_text(), "Working for 2s");
  const retrying = { ...turn("a_retry", "streaming", [], created_at), retry: { attempt: 1, max: 5, reason: "", until: Date.now() + 4_000 } };
  show("c_retry", retrying);
  assert.equal(head_text(), "Working for 2s");
  assert.equal(with_class("retry-banner").length, 1);
  show("c_retry", null);
});

test("blank reasoning rows between the last activity and the answer fold with the activity", () => {
  show("c_hidden", turn("a_hidden", "done", [reasoning("r1", 1_000, ""), tool("rd", "read_file", 4_000), reasoning("r2", 6_000, ""), text("t1", "Done.")]));
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 6s");
  assert.deepEqual(visible(), ["text", "file_changes"]);
  press(toggle()!);
  assert.deepEqual(visible(), ["reasoning", "work", "reasoning", "text", "file_changes"]);
  show("c_hidden", turn("a_hidden_plain", "done", [reasoning("r1", 1_000, ""), text("t1", "Hello")]));
  assert.equal(head_text(), null);
  assert.deepEqual(visible(), ["reasoning", "text", "file_changes"]);
  show("c_hidden", null);
});

test("done, failed and blocked turns without any answer text get no header; a stopped answer still does", () => {
  const work: Step[] = [reasoning("r1", 1_000), tool("rd", "read_file", 4_000)];
  show("c_quiet", turn("a_done", "done", work));
  assert.equal(head_text(), null);
  assert.deepEqual(visible(), ["work", "file_changes"]);
  show("c_quiet", turn("a_failed", "failed", work));
  assert.equal(head_text(), null);
  assert.equal(with_class("error-card").length, 1);
  show("c_quiet", turn("a_blocked", "blocked", work));
  assert.equal(head_text(), null);
  show("c_quiet", turn("a_failed_text", "failed", [...work, text("t1", "Partial")]));
  assert.equal(head_text(), "Worked for 4s");
  assert.equal(toggle(), null);
  show("c_quiet", turn("a_stopped", "stopped", [], at(0), at(3_400)));
  assert.equal(head_text(), "You stopped after 3s");
  assert.equal(with_class("assistant-note").length, 0);
  show("c_quiet", null);
});

test("a compaction as the last activity step measures up to the end of the turn", () => {
  const compaction: Step = { id: "cp", round: 2, kind: "compaction", status: "done", source: "auto" };
  show("c_cp", turn("a_cp", "done", [tool("rd", "read_file", 5_000), compaction, text("t1", "Done.")], at(0), at(60_000)));
  assert.equal(head_text(), "Worked for 1m");
  show("c_cp", null);
});

test("durations keep seconds past an hour and show zero seconds", () => {
  show("c_long", turn("a_long", "streaming", [tool("rd", "read_file", null)], ago(3_725_400)));
  assert.equal(head_text(), "Working for 1h 2m 5s");
  show("c_long", null);
  show("c_long", turn("a_short", "done", [tool("rd", "read_file", 900), text("t1", "Done.")]));
  assert.equal(head_text(), "Worked for 0s");
  show("c_long", null);
});

test("an answer continued after the output limit stays one visible answer", () => {
  const continued = (id: string): Step[] => [text(`${id}_1`, "First half"), notice(`${id}_n`, "output_limit"), reasoning(`${id}_r`, 9_000), text(`${id}_2`, "second half")];
  show("c_cut", turn("a_cut", "done", [tool("rd", "read_file", 5_000), ...continued("a")]));
  assert.equal(expanded(), "false");
  assert.equal(head_text(), "Worked for 5s");
  assert.deepEqual(visible(), ["text", "text", "file_changes"]);
  press(toggle()!);
  assert.deepEqual(visible(), ["work", "text", "notice", "reasoning", "text", "file_changes"]);
  show("c_cut", turn("a_plain_cut", "streaming", continued("b").slice(0, 3), ago(2_000)));
  assert.equal(head_text(), null);
  show("c_cut", turn("a_plain_cut", "done", continued("b")));
  assert.equal(head_text(), null);
  assert.deepEqual(visible(), ["text", "notice", "reasoning", "text", "file_changes"]);
  show("c_cut", null);
});

test("a held turn keeps working while the agent list of the chat loads, and an own send does not fold it while its agent runs", () => {
  agents("c_switch", "loading", "running");
  show("c_switch", turn("a_switch", "done", deployed("s", "c_switch")));
  assert.equal(toggle(), null);
  agents("c_switch", "ready", "running");
  assert.equal(toggle(), null);
  agents("c_switch", "loading", "completed");
  assert.equal(expanded(), "false");
  agents("c_held", "ready", "running");
  const held = turn("a_held", "done", deployed("h", "c_held"));
  show("c_held", held);
  assert.equal(toggle(), null);
  open_chat("c_held", [{ id: "u_first", role: "user", text: "go", attachments: [], origin: "user", created_at: at(0) }, held]);
  append("c_held", "user");
  assert.equal(toggle(), null);
  assert.match(head_text() ?? "", /^Working for /);
  agents("c_held", "ready", "completed");
  assert.equal(expanded(), "false");
  show("c_held", null);
});

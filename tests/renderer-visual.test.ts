import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Step, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { visual_tool_name, visual_vars } from "../shared/visual.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { member_facts, turn_shape } from "../src/features/chat/turn-shape.ts";
import { visual_tokens, visual_vars_css } from "../src/features/chat/visual-theme.ts";
import { has_body } from "../src/features/tools/tool-body.ts";
import { tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { group_label } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { chip_line, empty_composer, has_chip, message_text, take_draft, toggle_chip, visualize_chip } from "../src/state/chat-drafts.ts";
import { tokens } from "./css-kit.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const view: ToolView = { kind: "visual", title: "Pointer chain", code: "<p>chain</p>" };

const visual = (id: string, status: ToolStep["status"], args: Record<string, unknown> = { title: "Pointer chain", code: "<p>chain</p>" }): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${id}`,
  name: visual_tool_name,
  args,
  status,
  progress: null,
  approval: null,
  view: status === "done" ? view : null,
  error: status === "failed" ? "bad args" : null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" || status === "failed" ? 2000 : null,
});

const read: ToolStep = { ...visual("read", "done"), name: "read_file", view: { kind: "read", path: "a.ts", start_line: 1, end_line: 2, total_lines: 2, truncated: false } };

const text = (id: string, value: string): Step => ({ id, round: 1, kind: "text", text: value });

test("a finished visualization becomes its own block outside the tool groups", () => {
  const blocks = build_blocks([read, visual("v1", "done"), text("t1", "Here it is")]);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["work", "visual", "text"],
  );
  const block = blocks[1];
  assert.equal(block.kind === "visual" && block.view.code, "<p>chain</p>");
});

test("a visualization that is still running, failed or was denied stays a tool row", () => {
  for (const status of ["drafting", "queued", "running", "failed", "denied"] as const) {
    const blocks = build_blocks([read, visual("v1", status)]);
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["work"],
      status,
    );
  }
});

test("a done turn keeps the visualization visible as part of the answer when it folds", () => {
  const message: AssistantMessage = {
    id: "a1",
    role: "assistant",
    model: "m",
    effort: "",
    mode: "auto",
    plan: false,
    created_at: new Date(0).toISOString(),
    ended_at: new Date(3000).toISOString(),
    status: "done",
    steps: [read, visual("v1", "done"), text("t1", "Here it is")],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  const facts = member_facts(message, build_blocks(message.steps));
  const shape = turn_shape([facts]);
  assert.equal(shape.foldable, true);
  assert.equal(shape.head?.kind, "worked");
  assert.deepEqual([...(shape.folds[0] ?? [])], ["read"]);
});

test("the tool row names the visualization while it is drafted and once the title is known", () => {
  assert.equal(tool_meta(visual("v1", "running")).icon, "visual");
  assert.equal(tool_label(t, visual("v1", "drafting", {})), "Creating visualization");
  assert.equal(tool_label(t, visual("v1", "running")), "Creating visualization: Pointer chain");
  assert.equal(tool_label(t, visual("v1", "failed")), "Created visualization: Pointer chain");
  assert.equal(tool_label(de, visual("v1", "running", {})), "Erstellt Visualisierung");
  assert.equal(has_body(t, visual("v1", "done")), false);
  assert.equal(has_body(t, visual("v1", "failed")), true);
  assert.equal(group_label(t, [visual("v1", "failed"), visual("v2", "failed")]), "Created visualizations");
});

test("every injected variable maps to an app token that exists", () => {
  assert.deepEqual(Object.keys(visual_tokens).sort(), visual_vars.map((entry) => entry.name).sort());
  for (const token of Object.values(visual_tokens)) {
    assert.ok(tokens[token] !== undefined, token);
  }
  assert.equal(visual_tokens["--vx-accent"], "--accent");
  assert.equal(visual_tokens["--vx-surface"], "--surface-card");
  assert.equal(visual_tokens["--vx-border"], "--ring-card");
});

test("the variables text carries the values read for each mapped token", () => {
  const css = visual_vars_css((token) => tokens[token] ?? "");
  assert.ok(css.includes("--vx-accent: #a67df2;"));
  assert.ok(css.includes(`--vx-font: ${tokens["--font-ui"]};`));
  assert.equal(css.split(";").filter((part) => part.trim()).length, visual_vars.length);
});

test("the visualize chip asks for the visualize tool above the typed text", () => {
  const state = toggle_chip(empty_composer, "c1", visualize_chip);
  const draft = { ...state.drafts.c1, text: "how does the entity list chain work" };
  assert.equal(has_chip(draft, visualize_chip), true);
  assert.match(chip_line(visualize_chip), /^Answer this message with the visualize tool: /);
  assert.equal(message_text(draft), `${chip_line(visualize_chip)}\n\nhow does the entity list chain work`);
  assert.deepEqual(take_draft({ ...state, drafts: { c1: draft } }, "c1").state.drafts.c1.chips, []);
  assert.equal(has_chip(toggle_chip(state, "c1", visualize_chip).drafts.c1, visualize_chip), false);
});

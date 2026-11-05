import assert from "node:assert/strict";
import { test } from "node:test";
import { skips_unanswered, type ApprovalRequest } from "../shared/approval.ts";
import type { AssistantMessage, Message, ToolStep } from "../shared/chat.ts";
import type { ComputerShotRef, ComputerView } from "../shared/tool-view.ts";
import { approval_question, grant_options } from "../src/features/tools/approval-options.ts";
import { computer_marks, shot_frame } from "../src/features/tools/computer-shots.ts";
import { approval_lines } from "../src/features/tools/review-notes.ts";
import { has_body } from "../src/features/tools/tool-body.ts";
import { tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { group_label } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const step = (name: string, args: Record<string, unknown>, view: ComputerView | null = null, status: ToolStep["status"] = "done", extra: Partial<ToolStep> = {}): ToolStep => ({
  id: `tool:1:${name}:${JSON.stringify(args)}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status,
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" ? 2500 : null,
  ...extra,
});

const shot_view: Extract<ComputerView, { action: "screenshot" }> = { kind: "computer", action: "screenshot", image_w: 1280, image_h: 720 };

const screenshot = (image_id: string, view = shot_view) =>
  step("computer_screenshot", {}, view, "done", { id: `tool:shot:${image_id}`, call_id: `call-${image_id}`, images: [{ id: image_id, label: "screenshot" }] });

const ref = (message_id: string, image_id: string): ComputerShotRef => ({ message_id, call_id: `call-${image_id}` });

const click_view = (x: number, y: number, shot: ComputerShotRef | undefined = ref("a1", "img_a.png"), extra: Partial<Extract<ComputerView, { action: "click" }>> = {}): ComputerView => ({
  kind: "computer",
  action: "click",
  x,
  y,
  button: "left",
  count: 1,
  modifiers: [],
  shot,
  ...extra,
});

const assistant = (id: string, steps: ToolStep[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "a/b",
  effort: "high",
  mode: "ask",
  plan: false,
  created_at: "2026-11-04T10:00:00.000Z",
  ended_at: null,
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 0,
});

test("every computer action has its own icon and the computer category", () => {
  const icons: Record<string, string> = {
    computer_screenshot: "computer_screenshot",
    computer_click: "computer_click",
    computer_move: "computer_move",
    computer_drag: "computer_drag",
    computer_scroll: "computer_scroll",
    computer_type: "computer_type",
    computer_key: "computer_key",
    computer_wait: "computer_wait",
  };
  for (const [name, icon] of Object.entries(icons)) {
    assert.equal(tool_meta(step(name, {})).icon, icon, name);
    assert.equal(tool_meta(step(name, {})).category, "computer", name);
  }
  assert.equal(tool_meta(step("unknown_computer_action", {}, click_view(1, 2))).icon, "computer");
});

test("computer rows name the action and its point while running and when done", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    ["computer_screenshot", {}, "Taking a screenshot", "Took a screenshot"],
    ["computer_click", { x: 412, y: 230 }, "Clicking 412, 230", "Clicked 412, 230"],
    ["computer_click", { x: 412, y: 230, count: 2 }, "Double-clicking 412, 230", "Double-clicked 412, 230"],
    ["computer_click", { x: 412, y: 230, count: 3 }, "Triple-clicking 412, 230", "Triple-clicked 412, 230"],
    ["computer_click", { x: 412, y: 230, button: "right" }, "Right-clicking 412, 230", "Right-clicked 412, 230"],
    ["computer_click", { x: 1, y: 2, button: "middle" }, "Middle-clicking 1, 2", "Middle-clicked 1, 2"],
    ["computer_click", { x: 1, y: 2, modifiers: ["Alt"] }, "Clicking 1, 2 with Alt", "Clicked 1, 2 with Alt"],
    ["computer_move", { x: 5, y: 6 }, "Moving the pointer to 5, 6", "Moved the pointer to 5, 6"],
    ["computer_drag", { from_x: 1, from_y: 2, to_x: 300, to_y: 400 }, "Dragging from 1, 2 to 300, 400", "Dragged from 1, 2 to 300, 400"],
    ["computer_scroll", { x: 1, y: 1, direction: "down" }, "Scrolling down", "Scrolled down"],
    ["computer_scroll", { x: 1, y: 1, direction: "left" }, "Scrolling left", "Scrolled left"],
    ["computer_type", { text: "hello world" }, 'Typing "hello world"', 'Typed "hello world"'],
    ["computer_type", { text: "line one\nline two" }, "Typing text", "Typed text"],
    ["computer_key", { keys: "ctrl+s" }, "Pressing ctrl+s", "Pressed ctrl+s"],
    ["computer_wait", { seconds: 2 }, "Waiting 2s", "Waited 2s"],
  ];
  for (const [name, args, running, done] of cases) {
    assert.equal(tool_label(t, step(name, args, null, "running")), running, name);
    assert.equal(tool_label(t, step(name, args, null, "done")), done, name);
  }
});

test("click labels take the button, the count, the modifiers and the point from the view", () => {
  const label = (args: Record<string, unknown>, view: ComputerView, translate_with = t) => tool_label(translate_with, step("computer_click", args, view));
  assert.equal(label({ x: 5000, y: 300 }, click_view(1279, 300)), "Clicked 1279, 300");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { button: "right", count: 2 })), "Right-clicked 412, 230 2 times");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { button: "middle" })), "Middle-clicked 412, 230");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { button: "middle", count: 3 })), "Middle-clicked 412, 230 3 times");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { modifiers: ["Shift"] })), "Clicked 412, 230 with Shift");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { count: 2, modifiers: ["Control", "Shift"] })), "Double-clicked 412, 230 with Control+Shift");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { button: "right", count: 3 }), de), "412, 230 3-mal rechts geklickt");
  assert.equal(label({ x: 412, y: 230 }, click_view(412, 230, undefined, { modifiers: ["Shift"] }), de), "412, 230 mit Shift geklickt");
});

test("move and drag labels take the point from the view", () => {
  const drag: ComputerView = { kind: "computer", action: "drag", x: 1, y: 2, to_x: 1279, to_y: 719, button: "left" };
  assert.equal(tool_label(t, step("computer_drag", { from_x: 1, from_y: 2, to_x: 4000, to_y: 9000 }, drag)), "Dragged from 1, 2 to 1279, 719");
  const move: ComputerView = { kind: "computer", action: "move", x: 0, y: 719 };
  assert.equal(tool_label(t, step("computer_move", { x: -5, y: 900 }, move)), "Moved the pointer to 0, 719");
});

test("failed and denied computer rows read as an attempt and as denied computer use", () => {
  assert.equal(tool_label(t, step("computer_click", { x: 1, y: 2 }, null, "failed")), "Click");
  assert.equal(tool_label(t, step("computer_key", { keys: "alt+f4" }, null, "failed")), "Press alt+f4");
  assert.equal(tool_label(t, step("computer_click", { x: 1, y: 2 }, null, "denied")), "Denied computer use");
  assert.equal(tool_label(de, step("computer_click", { x: 1, y: 2 }, null, "denied")), "Computersteuerung abgelehnt");
});

test("German computer rows use the app's verb forms", () => {
  assert.equal(tool_label(de, step("computer_click", { x: 412, y: 230 }, null, "running")), "Klickt 412, 230");
  assert.equal(tool_label(de, step("computer_click", { x: 412, y: 230 })), "412, 230 geklickt");
  assert.equal(tool_label(de, step("computer_screenshot", {})), "Screenshot gemacht");
  assert.equal(tool_label(de, step("computer_scroll", { direction: "up" })), "Nach oben gescrollt");
});

test("a group of computer actions counts them in one part of the group label", () => {
  const steps = [step("computer_screenshot", {}), step("computer_click", { x: 1, y: 2 }), step("computer_type", { text: "a" })];
  assert.equal(group_label(t, steps), "3 computer actions");
  assert.equal(group_label(de, [step("computer_key", { keys: "Return" })]), "1 Computeraktion");
});

test("a screenshot row opens only when it carries its stored screenshot", () => {
  assert.equal(has_body(t, screenshot("img_a.png")), true);
  assert.equal(has_body(t, step("computer_screenshot", {}, shot_view)), false);
  assert.equal(has_body(t, step("computer_screenshot", {}, null, "running")), false);
});

test("pointer rows open only when they name the screenshot they acted on, keyboard rows never open", () => {
  assert.equal(has_body(t, step("computer_click", { x: 320, y: 180 }, click_view(320, 180))), true);
  assert.equal(has_body(t, step("computer_click", { x: 320, y: 180 }, { kind: "computer", action: "click", x: 320, y: 180, button: "left", count: 1, modifiers: [] })), false);
  assert.equal(has_body(t, step("computer_move", { x: 1, y: 2 }, { kind: "computer", action: "move", x: 1, y: 2 })), false);
  assert.equal(has_body(t, step("computer_type", { text: "a" }, { kind: "computer", action: "type" })), false);
  assert.equal(has_body(t, step("computer_key", { keys: "Return" }, { kind: "computer", action: "key" })), false);
  assert.equal(has_body(t, step("computer_wait", { seconds: 1 }, { kind: "computer", action: "wait" })), false);
  assert.equal(has_body(t, { ...step("computer_click", { x: 1, y: 2 }, null, "failed"), error: "Take a screenshot first." }), true);
});

test("marks sit at the point as a share of the screenshot, a drag gets both ends, and marks stay on the image", () => {
  assert.deepEqual(computer_marks(click_view(320, 180), shot_view), [{ x: 25, y: 25 }]);
  assert.deepEqual(computer_marks({ kind: "computer", action: "drag", x: 0, y: 360, to_x: 1280, to_y: 720, button: "left" }, shot_view), [
    { x: 0, y: 50 },
    { x: 100, y: 100 },
  ]);
  assert.deepEqual(computer_marks({ kind: "computer", action: "scroll", x: 640, y: 72 }, shot_view), [{ x: 50, y: 10 }]);
  assert.deepEqual(computer_marks({ kind: "computer", action: "type" }, shot_view), []);
  assert.deepEqual(computer_marks(click_view(2000, -50), shot_view), [{ x: 100, y: 0 }]);
});

test("a pointer row shows exactly the screenshot it names, also from an earlier message", () => {
  const first = screenshot("img_first.png");
  const second = screenshot("img_second.png");
  const early = step("computer_click", { x: 1, y: 2 }, click_view(640, 360, ref("a1", "img_first.png")), "done", { id: "tool:click:early", call_id: "call-early" });
  const late = step("computer_click", { x: 3, y: 4 }, click_view(640, 360, ref("a1", "img_second.png")), "done", { id: "tool:click:late", call_id: "call-late" });
  const carried = step("computer_click", { x: 5, y: 6 }, click_view(640, 360, ref("a1", "img_second.png")), "done", { id: "tool:click:carried", call_id: "call-carried" });
  const user: Message = { id: "u2", role: "user", text: "go on", attachments: [], origin: "user", created_at: "2026-11-04T10:01:00.000Z" };
  const messages: Message[] = [assistant("a1", [first, early, second, late]), user, assistant("a2", [carried])];
  const frame_of = (entry: ToolStep) => (entry.view?.kind === "computer" ? shot_frame(messages, entry, entry.view) : null);
  assert.equal(frame_of(early)?.image.id, "img_first.png");
  assert.equal(frame_of(late)?.image.id, "img_second.png");
  assert.equal(frame_of(carried)?.image.id, "img_second.png");
  assert.deepEqual(frame_of(carried)?.marks, [{ x: 50, y: 50 }]);
});

test("a pointer row takes ratio and marks from the screenshot it names, not from any later one", () => {
  const small = screenshot("img_small.png", { kind: "computer", action: "screenshot", image_w: 1000, image_h: 500 });
  const wide = screenshot("img_wide.png");
  const click = step("computer_click", { x: 500, y: 250 }, click_view(500, 250, ref("a1", "img_small.png")));
  const messages = [assistant("a1", [small, wide, click])];
  assert.deepEqual(shot_frame(messages, click, click_view(500, 250, ref("a1", "img_small.png"))), {
    image: { id: "img_small.png", label: "screenshot" },
    ratio: 2,
    marks: [{ x: 50, y: 50 }],
  });
});

test("a pointer row whose screenshot is missing shows no frame", () => {
  const click = step("computer_click", { x: 1, y: 2 }, click_view(1, 2));
  const not_a_shot = step("computer_type", { text: "a" }, { kind: "computer", action: "type" }, "done", { call_id: "call-img_a.png" });
  assert.equal(shot_frame([assistant("a2", [click])], click, click_view(1, 2)), null);
  assert.equal(shot_frame([assistant("a1", [not_a_shot, click])], click, click_view(1, 2)), null);
});

test("the shot frame of a screenshot row is its own image without marks", () => {
  const shot = screenshot("img_frame.png");
  assert.deepEqual(shot_frame([assistant("a1", [shot])], shot, shot_view), { image: { id: "img_frame.png", label: "screenshot" }, ratio: 1280 / 720, marks: [] });
});

const computer_request: ApprovalRequest = { kind: "computer_use", display: "1", real_width: 2560, real_height: 1440 };

test("the computer use card asks once and allows the chat for the rest of the app session", () => {
  assert.deepEqual(
    grant_options(computer_request).map((option) => option.grant),
    ["chat"],
  );
  assert.equal(t(grant_options(computer_request)[0].label), "Yes, allow it in this chat until VantheaX quits");
  const question = approval_question(computer_request);
  assert.equal(t(question.key, question.vars), "May I control your computer?");
  assert.equal(de(question.key, question.vars), "Darf ich deinen Computer steuern?");
  assert.deepEqual(approval_lines(t, computer_request), []);
});

test("the computer use card never answers itself after a timeout", () => {
  assert.equal(skips_unanswered(computer_request), false);
});

test("the computer use card states plainly that screenshots go to the model provider", () => {
  assert.equal(t("approval.computer_screens"), "While I work, screenshots of your screen are sent to the model provider.");
  assert.equal(de("approval.computer_screens"), "Während ich arbeite, werden Screenshots deines Bildschirms an den Modellanbieter gesendet.");
  assert.equal(t("approval.computer_display", { x: "1", w: 2560, h: 1440 }), "Display 1 · 2560 × 1440");
});

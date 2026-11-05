import type { ToolStep } from "../../../shared/chat.ts";
import type { ComputerButton, ComputerView } from "../../../shared/tool-view.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { entry, fixed } from "./tool-meta-entry.ts";
import type { Label, ToolMeta } from "./tool-meta-types.ts";

type Phase = "active" | "done";

const number_arg = (step: ToolStep, key: string): number | null => {
  const value = step.args[key];
  return typeof value === "number" ? value : null;
};

const string_arg = (step: ToolStep, key: string): string => {
  const value = step.args[key];
  return typeof value === "string" ? value : "";
};

const point = (step: ToolStep, x_key: string, y_key: string): string => {
  const x = number_arg(step, x_key);
  const y = number_arg(step, y_key);
  return x === null || y === null ? "" : `${x}, ${y}`;
};

const computer_view = (step: ToolStep): ComputerView | null => (step.view?.kind === "computer" ? step.view : null);

type Click = { point: string; button: ComputerButton; count: number; modifiers: string[] };

const button_arg = (step: ToolStep): ComputerButton => {
  const button = string_arg(step, "button");
  return button === "right" || button === "middle" ? button : "left";
};

const modifiers_arg = (step: ToolStep): string[] => {
  const value = step.args.modifiers;
  return Array.isArray(value) ? value.filter((modifier): modifier is string => typeof modifier === "string") : [];
};

const click_of = (step: ToolStep): Click => {
  const view = computer_view(step);
  if (view?.action === "click") {
    return { point: `${view.x}, ${view.y}`, button: view.button, count: view.count, modifiers: view.modifiers };
  }
  return { point: point(step, "x", "y"), button: button_arg(step), count: number_arg(step, "count") ?? 1, modifiers: modifiers_arg(step) };
};

type ClickKind = "click" | "double_click" | "triple_click" | "right_click" | "right_clicks" | "middle_click" | "middle_clicks";

const click_kind = (click: Click): ClickKind => {
  if (click.button === "right") {
    return click.count > 1 ? "right_clicks" : "right_click";
  }
  if (click.button === "middle") {
    return click.count > 1 ? "middle_clicks" : "middle_click";
  }
  if (click.count === 2) {
    return "double_click";
  }
  return click.count === 3 ? "triple_click" : "click";
};

const click_label = (phase: Phase): Label => (t, step) => {
  const click = click_of(step);
  const target = click.modifiers.length > 0 ? t("computer.with_keys", { x: click.point, y: click.modifiers.join("+") }) : click.point;
  return t(`computer.${click_kind(click)}_${phase}`, { x: target, n: click.count });
};

const move_point = (step: ToolStep): string => {
  const view = computer_view(step);
  return view?.action === "move" ? `${view.x}, ${view.y}` : point(step, "x", "y");
};

const move_label = (phase: Phase): Label => (t, step) => t(`computer.move_${phase}`, { x: move_point(step) });

const drag_label = (phase: Phase): Label => (t, step) => {
  const view = computer_view(step);
  if (view?.action === "drag") {
    return t(`computer.drag_${phase}`, { x: `${view.x}, ${view.y}`, y: `${view.to_x}, ${view.to_y}` });
  }
  return t(`computer.drag_${phase}`, { x: point(step, "from_x", "from_y"), y: point(step, "to_x", "to_y") });
};

const scroll_direction = (step: ToolStep): "up" | "down" | "left" | "right" | null => {
  const direction = string_arg(step, "direction");
  return direction === "up" || direction === "down" || direction === "left" || direction === "right" ? direction : null;
};

const scroll_label = (phase: Phase): Label => (t, step) => {
  const direction = scroll_direction(step);
  return direction ? t(`computer.scroll_${direction}_${phase}`) : t(`computer.scroll_${phase}`);
};

const type_label = (phase: Phase): Label => (t, step) => {
  const text = string_arg(step, "text");
  return text && !text.includes("\n") ? t(`computer.type_${phase}`, { x: `"${text}"` }) : t(`computer.type_text_${phase}`);
};

const key_label = (key: MessageKey): Label => (t, step) => t(key, { x: string_arg(step, "keys") });

const wait_label = (phase: Phase): Label => (t, step) => {
  const seconds = number_arg(step, "seconds");
  return seconds === null ? t(`computer.wait_plain_${phase}`) : t(`computer.wait_${phase}`, { n: seconds });
};

const computer_tools = new Set([
  "computer_screenshot",
  "computer_click",
  "computer_move",
  "computer_drag",
  "computer_scroll",
  "computer_type",
  "computer_key",
  "computer_wait",
]);

export const computer_metas: Record<string, ToolMeta> = {
  computer_screenshot: entry("computer_screenshot", "computer", fixed("computer.screenshot_active"), fixed("computer.screenshot_done"), fixed("computer.screenshot_attempt")),
  computer_click: entry("computer_click", "computer", click_label("active"), click_label("done"), fixed("computer.click_attempt")),
  computer_move: entry("computer_move", "computer", move_label("active"), move_label("done"), fixed("computer.move_attempt")),
  computer_drag: entry("computer_drag", "computer", drag_label("active"), drag_label("done"), fixed("computer.drag_attempt")),
  computer_scroll: entry("computer_scroll", "computer", scroll_label("active"), scroll_label("done"), fixed("computer.scroll_attempt")),
  computer_type: entry("computer_type", "computer", type_label("active"), type_label("done"), fixed("computer.type_attempt")),
  computer_key: entry("computer_key", "computer", key_label("computer.key_active"), key_label("computer.key_done"), key_label("computer.key_attempt")),
  computer_wait: entry("computer_wait", "computer", wait_label("active"), wait_label("done")),
};

export const computer_kind_meta = entry("computer", "computer", fixed("computer.use_active"), fixed("computer.use_done"));

export const computer_target_key = (name: string): MessageKey | null => (computer_tools.has(name) ? "computer.denied_target" : null);

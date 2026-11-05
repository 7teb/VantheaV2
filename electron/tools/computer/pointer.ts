import { read_modifiers } from "../../computer/coords.ts";
import { read_choice } from "../browser/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { number_arg, point_args, run_computer } from "./common.ts";

const coordinates = { x: { type: "number" }, y: { type: "number" } };
const buttons = ["left", "right", "middle"] as const;

export const computer_click = define_tool({
  spec: {
    name: "computer_click",
    description: "Click at x,y in the latest computer_screenshot image. Optional left/right/middle button, count 1-3, and Control/Shift/Alt/Meta modifiers. Input into VantheaX and its overlay is blocked. Get confirmation for consequential actions according to the user's request and the computer-use skill. Take a new screenshot to verify what happened.",
    parameters: { type: "object", properties: { ...coordinates, button: { type: "string", enum: buttons }, count: { type: "integer", enum: [1, 2, 3] }, modifiers: { type: "array", items: { type: "string", enum: ["Control", "Shift", "Alt", "Meta"] } } }, required: ["x", "y"], additionalProperties: false },
  },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => {
    const count = raw.count === undefined ? 1 : number_arg(raw, "count");
    if (![1, 2, 3].includes(count)) throw new ToolArgumentError("count must be 1, 2 or 3");
    const modifiers = read_modifiers(raw.modifiers);
    return { ...point_args(raw), count, button: read_choice(raw, "button", buttons, "left"), modifiers: modifiers.codes, modifier_names: modifiers.names };
  },
  run: (ctx, args) => run_computer(ctx, { op: "click", ...args }),
});

export const computer_move = define_tool({
  spec: { name: "computer_move", description: "Move the pointer to x,y in the latest computer_screenshot image. Use a fresh screenshot to check hover effects. Cannot target VantheaX or its overlay.", parameters: { type: "object", properties: coordinates, required: ["x", "y"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: point_args,
  run: (ctx, args) => run_computer(ctx, { op: "move", ...args }),
});

export const computer_drag = define_tool({
  spec: { name: "computer_drag", description: "Drag from from_x,from_y to to_x,to_y in the latest computer_screenshot image. Defaults to the left button. Never drag through VantheaX or the live indicator. Take a new screenshot to verify the result.", parameters: { type: "object", properties: { from_x: { type: "number" }, from_y: { type: "number" }, to_x: { type: "number" }, to_y: { type: "number" }, button: { type: "string", enum: buttons } }, required: ["from_x", "from_y", "to_x", "to_y"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => ({ x: number_arg(raw, "from_x"), y: number_arg(raw, "from_y"), to_x: number_arg(raw, "to_x"), to_y: number_arg(raw, "to_y"), button: read_choice(raw, "button", buttons, "left") }),
  run: (ctx, args) => run_computer(ctx, { op: "drag", ...args }),
});

export const computer_scroll = define_tool({
  spec: { name: "computer_scroll", description: "Scroll under x,y in the latest computer_screenshot image, up/down/left/right. amount small sends 3 wheel notches, page sends 8. Focus the intended application first and take a screenshot to verify the result.", parameters: { type: "object", properties: { ...coordinates, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "string", enum: ["small", "page"] } }, required: ["x", "y", "direction"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => {
    const direction = read_choice(raw, "direction", ["up", "down", "left", "right"], null);
    const amount = read_choice(raw, "amount", ["small", "page"], "small") === "page" ? 960 : 360;
    return { ...point_args(raw), dx: direction === "left" ? -amount : direction === "right" ? amount : 0, dy: direction === "down" ? -amount : direction === "up" ? amount : 0 };
  },
  run: (ctx, args) => run_computer(ctx, { op: "scroll", ...args }),
});

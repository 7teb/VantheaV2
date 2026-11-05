import { parse_keys } from "../../computer/coords.ts";
import { require_string } from "../browser/common.ts";
import { define_tool, ToolArgumentError } from "../types.ts";
import { number_arg, run_computer } from "./common.ts";

export const computer_type = define_tool({
  spec: { name: "computer_type", description: "Type Unicode text at the focused control after checking focus on a computer_screenshot. Never use it to type passwords, tokens or payment data; let the user complete those fields. Does not paste through the clipboard. Keyboard input into VantheaX is blocked. Take a screenshot to verify.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => ({ text: require_string(raw, "text") }),
  run: (ctx, args) => run_computer(ctx, { op: "type", ...args }),
});

export const computer_key = define_tool({
  spec: { name: "computer_key", description: "Press a key or chord in the foreground application, such as Ctrl+S, Shift+Tab, Enter or Escape. Supports letters, digits, F1-F12, Tab, Space, arrows, Home, End, PageUp, PageDown, Backspace, Delete, Insert and Ctrl/Shift/Alt/Meta modifiers. Requires a prior computer_screenshot. Cannot send keys while VantheaX is in the foreground. Verify the result with a fresh screenshot.", parameters: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => ({ keys: parse_keys(require_string(raw, "keys")) }),
  run: (ctx, args) => run_computer(ctx, { op: "key", ...args }),
});

export const computer_wait = define_tool({
  spec: { name: "computer_wait", description: "Wait up to 10 seconds for the desktop UI to settle, then take computer_screenshot. Stop cancels the wait immediately.", parameters: { type: "object", properties: { seconds: { type: "number", minimum: 0, maximum: 10 } }, required: ["seconds"], additionalProperties: false } },
  profiles: ["main"],
  available: (_settings, model) => process.platform === "win32" && model.vision,
  parse: (raw) => { const seconds = number_arg(raw, "seconds"); if (seconds < 0 || seconds > 10) throw new ToolArgumentError("seconds must be between 0 and 10"); return { seconds }; },
  run: (ctx, args) => run_computer(ctx, { op: "wait", ...args }),
});

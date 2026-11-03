import type { ToolStep } from "../../../shared/chat.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import type { Label, ToolCategory, ToolIconName, ToolMeta } from "./tool-meta-types.ts";

export const fixed = (key: MessageKey): Label => (t) => t(key);

export const with_x = (key: MessageKey, pick: (step: ToolStep) => string): Label => (t, step) => t(key, { x: pick(step) });

export const entry = (icon: ToolIconName, category: ToolCategory, active: Label, done: Label = active, attempt: Label = done): ToolMeta => ({ icon, category, active, done, attempt });

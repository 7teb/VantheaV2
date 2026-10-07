import type { ToolStep } from "../../../shared/chat.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";

export type BodyProps<K extends ToolViewKind> = { view: Extract<ToolView, { kind: K }>; step: ToolStep };

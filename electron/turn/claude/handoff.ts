import { measure_request } from "../../context/calibration.ts";
import { fit_window } from "../../context/window.ts";
import type { ApiContentPart, ApiMessage } from "../../model/types.ts";
import { round_profile } from "../round.ts";
import type { TurnSession } from "../session.ts";
import { image_marker } from "./content.ts";

export const handoff_header =
  "[Earlier conversation of this chat, carried over by the app. Everything below up to the end marker already happened: the tool calls ran and their results are final. Do not repeat these calls and do not reply to this block. Continue with the message that follows the end marker.]";

export const handoff_footer = "[End of the earlier conversation.]";

const content_text = (content: string | ApiContentPart[] | null): string =>
  typeof content === "string" ? content : (content ?? []).map((part) => (part.type === "text" ? part.text : image_marker)).join("\n");

const message_lines = (message: ApiMessage, names: Map<string, string>): string[] => {
  if (message.role === "assistant") {
    const text = content_text(message.content);
    const calls = message.tool_calls ?? [];
    for (const call of calls) {
      names.set(call.id, call.function.name);
    }
    return [...(text ? [`ASSISTANT: ${text}`] : []), ...calls.map((call) => `TOOL CALL ${call.function.name} ${call.function.arguments}`)];
  }
  if (message.role === "tool") {
    return [`TOOL RESULT ${names.get(message.tool_call_id) ?? message.tool_call_id}: ${message.content}`];
  }
  const text = content_text(message.content);
  return text ? [`USER: ${text}`] : [];
};

export const handoff_text = (messages: ApiMessage[]): string | null => {
  const names = new Map<string, string>();
  const lines = messages.flatMap((message) => message_lines(message, names));
  return lines.length ? [handoff_header, ...lines, handoff_footer].join("\n\n") : null;
};

export const carried_history = (session: TurnSession, api_messages: ApiMessage[], end: number): string | null => {
  const specs = session.resolve_tools(round_profile(session)).map((tool) => tool.spec);
  if (fit_window(api_messages, session.model, measure_request(api_messages, specs, session.model, null)).length) {
    session.emit({ type: "notice", round: 0, notice: "context_trimmed", text: "" });
  }
  return handoff_text(api_messages.slice(1, end));
};

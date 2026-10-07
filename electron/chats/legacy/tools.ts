import type { NoticeStep, ToolStatus, ToolStep } from "../../../shared/chat.ts";
import { as_record, as_string, is_record } from "../../storage/coerce.ts";
import { legacy_view, shorten, type ViewContext } from "./views.ts";

type Raw = Record<string, unknown>;

export type StepContext = ViewContext & { call_id: (legacy_id: string) => string };

type Outcome = { status: ToolStatus; error: string | null };

const max_history_chars = 12_000;

const legacy_interrupted_note = "(command interrupted, the app was closed before it finished)";

const history_value = (value: unknown): string => {
  const text = JSON.stringify(value ?? {});
  return text.length <= max_history_chars ? text : JSON.stringify({ truncated: true, preview: text.slice(0, max_history_chars) });
};

const tool_outcome = (result: Raw): Outcome => {
  const error = as_string(result.error).trim();
  if (result.running === true || result.permissionRequired === true || result.userCancelled === true || error === legacy_interrupted_note) {
    return { status: "cancelled", error: error || null };
  }
  if (result.denied === true) {
    return { status: "denied", error: null };
  }
  if (error) {
    return { status: "failed", error };
  }
  if (result.isError === true) {
    return { status: "failed", error: shorten(as_string(result.content)) || "The MCP tool reported an error" };
  }
  return { status: "done", error: null };
};

const summary_text = (name: string, result: Raw, outcome: Outcome): string => {
  if (outcome.error) {
    return shorten(outcome.error);
  }
  if (outcome.status === "denied") {
    return "Denied by the user";
  }
  if (outcome.status === "cancelled") {
    return "Did not finish";
  }
  if (name === "datetime") {
    return `${as_string(result.datetime)} ${as_string(result.timezone)}`.trim();
  }
  if (is_record(result.submitted)) {
    return shorten(as_string(result.submitted.summary));
  }
  if (is_record(result.verifier)) {
    return shorten(as_string(result.verifier.feedback));
  }
  for (const key of ["analysis", "content", "message", "note"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) {
      return shorten(value);
    }
  }
  return shorten(JSON.stringify(result));
};

const output_notice = (result: Raw, round: number, index: number): NoticeStep => ({
  id: `notice:${round}:${index}`,
  round,
  kind: "notice",
  notice: "output_limit",
  text: shorten(as_string(result.message, "The model hit its maximum output length."), 600),
});

export const legacy_tool_step = (value: unknown, round: number, index: number, ctx: StepContext): ToolStep | NoticeStep => {
  const tool = as_record(value);
  const name = as_string(tool.name).trim() || "unknown_tool";
  const args = as_record(tool.args);
  const result = as_record(tool.result);
  if (name === "max_output_error" || result.maxOutputError === true) {
    return output_notice(result, round, index);
  }
  const outcome = tool_outcome(result);
  const settled = outcome.status === "done" || outcome.status === "failed";
  const view = settled ? legacy_view(name, args, result, ctx) : null;
  return {
    id: `tool:${round}:${index}`,
    round,
    kind: "tool",
    index,
    call_id: ctx.call_id(as_string(tool.id)),
    name,
    args,
    status: outcome.status,
    progress: null,
    approval: null,
    view: view ?? { kind: "text", text: summary_text(name, result, outcome) },
    error: outcome.error,
    result_text: history_value(result),
    started_at: null,
    ended_at: null,
  };
};

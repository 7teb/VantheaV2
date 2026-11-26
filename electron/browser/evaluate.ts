import { as_record, as_string } from "../storage/coerce.ts";
import { cdp, ensure_debugger } from "./cdp.ts";
import { exception_text, remote_object_text } from "./console-text.ts";
import { error_text, type BrowserTab } from "./state.ts";

export type EvalOutcome = { thrown: boolean; kind: string; text: string };

export type EvaluateResponse = { result?: unknown; exceptionDetails?: unknown };

const object_group = "vx-eval";

const eval_timeout_ms = 10000;

const value_kind = (result: Record<string, unknown>): string => {
  const subtype = as_string(result.subtype);
  if (subtype) {
    return subtype;
  }
  if (result.type === "object") {
    return as_string(result.className) || "object";
  }
  return as_string(result.type) || "unknown";
};

export const eval_outcome = (response: EvaluateResponse): EvalOutcome => {
  if (response.exceptionDetails !== undefined) {
    return { thrown: true, kind: "threw", text: exception_text(response.exceptionDetails) || "The expression threw." };
  }
  const result = as_record(response.result);
  return { thrown: false, kind: value_kind(result), text: remote_object_text(result) };
};

const run_expression = async (tab: BrowserTab, expression: string, signal: AbortSignal): Promise<EvalOutcome> => {
  const params = { expression, objectGroup: object_group, generatePreview: true, timeout: eval_timeout_ms, silent: true };
  try {
    return eval_outcome(await cdp<EvaluateResponse>(tab, "Runtime.evaluate", params, "", signal));
  } catch (error) {
    if (signal.aborted || !error_text(error).includes("Execution was terminated")) {
      throw error;
    }

    return { thrown: true, kind: "timed out", text: `The expression ran longer than ${eval_timeout_ms / 1000} s and was stopped.` };
  }
};

export const evaluate_expression = async (tab: BrowserTab, expression: string, signal: AbortSignal): Promise<EvalOutcome> => {
  await ensure_debugger(tab, signal);
  try {
    return await run_expression(tab, expression, signal);
  } finally {
    try {
      await cdp(tab, "Runtime.releaseObjectGroup", { objectGroup: object_group }, "", new AbortController().signal);
    } catch (error) {
      console.warn(`[browser] releasing eval objects of tab ${tab.tab_id} failed: ${error_text(error)}`);
    }
  }
};

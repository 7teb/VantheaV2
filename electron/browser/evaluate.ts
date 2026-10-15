import { as_record, as_string } from "../storage/coerce.ts";
import { cdp, ensure_debugger } from "./cdp.ts";
import { exception_text, remote_object_text } from "./console-text.ts";
import { error_text, type BrowserTab } from "./state.ts";

export type EvalOutcome = { thrown: boolean; kind: string; text: string };

export type EvaluateResponse = { result?: unknown; exceptionDetails?: unknown };

const object_group = "vx-eval";

const eval_timeout_ms = 10000;

const side_effect_note =
  "browser_eval runs only side-effect-free JavaScript, and V8 could not rule out that this expression changes page state, so it was not run. Read state with pure expressions instead, and use browser_click or browser_type to interact.";

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
    const text = exception_text(response.exceptionDetails) || "The expression threw.";
    const side_effect = text.includes("Possible side-effect");
    return { thrown: true, kind: side_effect ? "side effect" : "threw", text: side_effect ? `${text}\n${side_effect_note}` : text };
  }
  const result = as_record(response.result);
  return { thrown: false, kind: value_kind(result), text: remote_object_text(result) };
};

export const evaluate_safely = async (tab: BrowserTab, expression: string, signal: AbortSignal): Promise<EvalOutcome> => {
  await ensure_debugger(tab, signal);
  try {
    const response = await cdp<EvaluateResponse>(
      tab,
      "Runtime.evaluate",
      { expression, objectGroup: object_group, generatePreview: true, throwOnSideEffect: true, timeout: eval_timeout_ms, silent: true },
      "",
      signal,
    );
    return eval_outcome(response);
  } catch (error) {
    if (signal.aborted || !error_text(error).includes("Execution was terminated")) {
      throw error;
    }
    return { thrown: true, kind: "timed out", text: `The expression ran longer than ${eval_timeout_ms / 1000} s and was stopped.` };
  } finally {
    try {
      await cdp(tab, "Runtime.releaseObjectGroup", { objectGroup: object_group }, "", new AbortController().signal);
    } catch (error) {
      console.warn(`[browser] releasing eval objects of tab ${tab.tab_id} failed: ${error_text(error)}`);
    }
  }
};

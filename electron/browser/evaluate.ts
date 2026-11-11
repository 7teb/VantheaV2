import { as_record, as_string } from "../storage/coerce.ts";
import { cdp, ensure_debugger } from "./cdp.ts";
import { exception_text, remote_object_text } from "./console-text.ts";
import { ensure_eval_world } from "./eval-world.ts";
import { error_text, type BrowserTab } from "./state.ts";

export type EvalOutcome = { thrown: boolean; kind: string; text: string };

export type EvalResult = EvalOutcome & { isolated: boolean };

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

const evaluate_once = async (tab: BrowserTab, params: Record<string, unknown>, signal: AbortSignal): Promise<EvalOutcome> => {
  try {
    return eval_outcome(await cdp<EvaluateResponse>(tab, "Runtime.evaluate", params, "", signal));
  } catch (error) {
    if (signal.aborted || !error_text(error).includes("Execution was terminated")) {
      throw error;
    }

    return { thrown: true, kind: "timed out", text: `The expression ran longer than ${eval_timeout_ms / 1000} s and was stopped.` };
  }
};

const eval_world_context = async (tab: BrowserTab, signal: AbortSignal): Promise<number | null> => {
  try {
    return await ensure_eval_world(tab, signal);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.warn(`[browser] isolated eval context of tab ${tab.tab_id} failed: ${error_text(error)}`);
    return null;
  }
};

const retry_isolated = async (tab: BrowserTab, params: Record<string, unknown>, refused: EvalOutcome, signal: AbortSignal): Promise<EvalResult> => {
  const context_id = await eval_world_context(tab, signal);
  if (context_id === null) {
    return { ...refused, isolated: false };
  }

  const isolated = await evaluate_once(tab, { ...params, contextId: context_id }, signal);
  if (isolated.kind === "side effect") {
    return { ...refused, isolated: false };
  }

  return { ...isolated, isolated: true };
};

export const evaluate_safely = async (tab: BrowserTab, expression: string, signal: AbortSignal): Promise<EvalResult> => {
  await ensure_debugger(tab, signal);
  const params = { expression, objectGroup: object_group, generatePreview: true, throwOnSideEffect: true, timeout: eval_timeout_ms, silent: true };
  try {
    const in_page = await evaluate_once(tab, params, signal);
    if (in_page.kind !== "side effect") {
      return { ...in_page, isolated: false };
    }

    return await retry_isolated(tab, params, in_page, signal);
  } finally {
    try {
      await cdp(tab, "Runtime.releaseObjectGroup", { objectGroup: object_group }, "", new AbortController().signal);
    } catch (error) {
      console.warn(`[browser] releasing eval objects of tab ${tab.tab_id} failed: ${error_text(error)}`);
    }
  }
};

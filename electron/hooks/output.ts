import type { HookFailure, HookRun, HookRunStatus } from "../../shared/hook-notes.ts";
import type { Hook, HookEvent } from "../../shared/hooks.ts";
import { error_text, is_record } from "../storage/coerce.ts";
import type { HookExit } from "./run.ts";

type Stdout = { kind: "none" } | { kind: "plain"; text: string } | { kind: "json"; value: Record<string, unknown> } | { kind: "invalid"; message: string };

export type JsonEffect = { block: string | null; context: string | null };

export type HookEffect = { block: { reason: string } | null; context: string | null; run: HookRun | null };

const permission_decisions = ["allow", "deny", "ask", "defer"];

const decision_events = new Set<HookEvent>(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop"]);

const context_events = new Set<HookEvent>(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStart", "SubagentStop"]);

export const classify_stdout = (text: string): Stdout => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "none" };
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { kind: "plain", text: trimmed };
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    return is_record(value) ? { kind: "json", value } : { kind: "invalid", message: "the output is not a JSON object" };
  } catch (error) {
    return { kind: "invalid", message: error_text(error) };
  }
};

const optional_text = (record: Record<string, unknown>, key: string, label: string): string | null => {
  const value = record[key];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
};

const specific_output = (value: Record<string, unknown>, event: HookEvent): Record<string, unknown> | null => {
  const specific = value.hookSpecificOutput;
  if (specific === undefined) {
    return null;
  }
  if (!is_record(specific)) {
    throw new Error("hookSpecificOutput must be an object");
  }
  if (specific.hookEventName !== event) {
    throw new Error(`hookSpecificOutput.hookEventName must be "${event}"`);
  }
  return specific;
};

const top_decision = (value: Record<string, unknown>, event: HookEvent): string | null => {
  if (!decision_events.has(event)) {
    return null;
  }
  const decision = optional_text(value, "decision", "decision");
  if (decision !== null && decision !== "block" && decision !== "approve") {
    throw new Error(`decision must be "block" or "approve", got ${JSON.stringify(decision).slice(0, 80)}`);
  }
  const reason = optional_text(value, "reason", "reason");
  if (decision !== "block") {
    return null;
  }
  if ((event === "Stop" || event === "SubagentStop") && !reason?.trim()) {
    throw new Error(`a ${event} block needs a reason`);
  }
  return reason ?? "";
};

const permission_block = (specific: Record<string, unknown> | null): string | null => {
  if (!specific) {
    return null;
  }
  const decision = optional_text(specific, "permissionDecision", "hookSpecificOutput.permissionDecision");
  if (decision !== null && !permission_decisions.includes(decision)) {
    throw new Error(`hookSpecificOutput.permissionDecision must be one of ${permission_decisions.join(", ")}`);
  }
  const reason = optional_text(specific, "permissionDecisionReason", "hookSpecificOutput.permissionDecisionReason");
  return decision === "deny" ? (reason ?? "") : null;
};

export const json_effect = (value: Record<string, unknown>, event: HookEvent): JsonEffect => {
  const specific = specific_output(value, event);
  const context = specific && context_events.has(event) ? optional_text(specific, "additionalContext", "hookSpecificOutput.additionalContext") : null;
  const decision = top_decision(value, event);
  const denied = event === "PreToolUse" ? permission_block(specific) : null;
  const block = denied ?? decision;
  return { block, context: event === "PreToolUse" || !context?.trim() ? null : context };
};

const run_of = (hook: Hook, status: HookRunStatus, text: string, exit_code: number | null, duration_ms: number, failure: HookFailure | null): HookRun => ({
  hook_id: hook.id,
  event: hook.event,
  shell: hook.shell,
  command: hook.command,
  status,
  text,
  exit_code,
  duration_ms,
  failure,
});

const blockable = new Set<HookEvent>(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop"]);

const joined = (...parts: (string | null)[]): string => parts.filter((part): part is string => Boolean(part?.trim())).join("\n\n");

const decided = (hook: Hook, exit: Extract<HookExit, { kind: "exited" }>, effect: JsonEffect, forced_block: string | null): HookEffect => {
  const block = forced_block ?? effect.block;
  if (block !== null && hook.event === "SubagentStart") {
    return { block: null, context: null, run: run_of(hook, "blocked", block, exit.exit_code, exit.duration_ms, null) };
  }
  if (block !== null && blockable.has(hook.event)) {
    const text = joined(block, effect.context);
    return { block: { reason: block }, context: effect.context, run: run_of(hook, "blocked", text || block, exit.exit_code, exit.duration_ms, null) };
  }
  if (effect.context !== null) {
    return { block: null, context: effect.context, run: run_of(hook, "context", effect.context, exit.exit_code, exit.duration_ms, null) };
  }
  return { block: null, context: null, run: null };
};

const silent: HookEffect = { block: null, context: null, run: null };

export const interpret = (hook: Hook, exit: Exclude<HookExit, { kind: "aborted" }>): HookEffect => {
  if (exit.kind === "timed_out") {
    return { block: null, context: null, run: run_of(hook, "error", "", null, exit.duration_ms, "timeout") };
  }
  if (exit.kind === "failed_start") {
    return { block: null, context: null, run: run_of(hook, "error", exit.message, null, exit.duration_ms, "start") };
  }
  if (hook.event === "StopFailure") {
    return silent;
  }
  const stdout = classify_stdout(exit.stdout);
  const stderr = exit.stderr.trim();
  const error = (text: string, failure: HookFailure | null): HookEffect => ({ block: null, context: null, run: run_of(hook, "error", text, exit.exit_code, exit.duration_ms, failure) });
  if (stdout.kind === "json") {
    let effect: JsonEffect;
    try {
      effect = json_effect(stdout.value, hook.event);
    } catch (failure) {
      return exit.exit_code === 2 ? decided(hook, exit, { block: null, context: null }, stderr) : error(error_text(failure), "json");
    }
    return decided(hook, exit, effect, exit.exit_code === 2 ? stderr || effect.block || "" : null);
  }
  if (exit.exit_code === 2) {
    return decided(hook, exit, { block: null, context: null }, stderr);
  }
  if (stdout.kind === "invalid") {
    return exit.exit_code === 0 ? error(stdout.message, "json") : error(stderr || stdout.message, null);
  }
  if (exit.exit_code !== 0) {
    return error(stderr, null);
  }
  if (stdout.kind === "plain" && hook.event === "UserPromptSubmit") {
    return decided(hook, exit, { block: null, context: stdout.text }, null);
  }
  return silent;
};

import type { SteerMessage, TurnError, UserOrigin } from "../../shared/chat.ts";
import { hook_notice_text, type HookRun } from "../../shared/hook-notes.ts";
import type { HookEvent } from "../../shared/hooks.ts";
import type { ToolView } from "../../shared/tool-view.ts";
import type { TurnNote } from "../turn/session.ts";
import { fire_hooks } from "./fire.ts";
import { common_input, tool_target, type HookCall, type HookIdentity } from "./input.ts";
import { blocked_tool_text, hook_note_content, hook_turn_error, post_tool_feedback, with_feedback } from "./text.ts";

export type HookToolEnd = { status: "done" | "failed"; text: string; view: ToolView | null; duration_ms: number };

export type SteerCheck = { kind: "aborted" } | { kind: "blocked" | "passed"; runs: HookRun[] };

export type SteerGate = { kind: "aborted" } | { kind: "blocked" } | { kind: "deliver"; notes: TurnNote[] };

export type PreToolGate = { kind: "aborted" } | { kind: "run"; runs: HookRun[] } | { kind: "blocked"; text: string; runs: HookRun[] };

export type PostToolGate = { kind: "aborted" } | { kind: "done"; result_text: string; runs: HookRun[] };

export type StopGate = { kind: "aborted" } | { kind: "end" } | { kind: "continue"; note: TurnNote };

export type PromptGate = { kind: "aborted" } | { kind: "blocked"; error: TurnError } | { kind: "go"; notes: TurnNote[] };

export type TurnHooks = {
  start?: () => Promise<TurnNote[]>;
  check_steer?: (steer: SteerMessage) => Promise<SteerCheck>;
  steer?: (steer: SteerMessage, round: number) => Promise<SteerGate>;
  pre_tool: (call: HookCall) => Promise<PreToolGate>;
  post_tool: (call: HookCall, end: HookToolEnd) => Promise<PostToolGate>;
  stop: (round: number, last_text: string, active: boolean) => Promise<StopGate>;
  stop_failure: (round: number, error: TurnError) => Promise<void>;
};

const note_of = (identity: HookIdentity, event: HookEvent, runs: HookRun[], round: number): TurnNote | null => {
  if (!runs.length) {
    return null;
  }
  const note = { event, runs };
  const text = hook_notice_text(note);
  const content = hook_note_content(note);
  if (content) {
    return { kind: "notice", notice: "hook", text, content };
  }
  identity.emit({ type: "notice", round, notice: "hook", text });
  return null;
};

const prompt_origins: ReadonlySet<UserOrigin> = new Set(["user", "init", "git_init", "review"]);

const prompt_input = (identity: HookIdentity, prompt: string, origin: UserOrigin | "steer") => ({ ...common_input(identity, "UserPromptSubmit"), prompt, origin });

export const prompt_hooks = async (identity: HookIdentity, prompt: string, origin: UserOrigin): Promise<PromptGate> => {
  if (!prompt_origins.has(origin)) {
    return { kind: "go", notes: [] };
  }
  const fired = await fire_hooks(identity, "UserPromptSubmit", null, prompt_input(identity, prompt, origin));
  if (fired.aborted) {
    return { kind: "aborted" };
  }
  if (fired.blocks.length) {
    return { kind: "blocked", error: hook_turn_error(fired.blocks) };
  }
  const note = note_of(identity, "UserPromptSubmit", fired.runs, 0);
  return { kind: "go", notes: note ? [note] : [] };
};

const check_steer = async (identity: HookIdentity, steer: SteerMessage): Promise<SteerCheck> => {
  const fired = await fire_hooks(identity, "UserPromptSubmit", null, prompt_input(identity, steer.text, "steer"));
  if (fired.aborted) {
    return { kind: "aborted" };
  }
  return { kind: fired.blocks.length ? "blocked" : "passed", runs: fired.runs };
};

const steer_hooks = (identity: HookIdentity): Pick<TurnHooks, "check_steer" | "steer"> => {
  const checks = new Map<string, Promise<SteerCheck>>();
  const checked = (steer: SteerMessage): Promise<SteerCheck> => {
    const known = checks.get(steer.id);
    if (known) {
      return known;
    }
    const started = check_steer(identity, steer);
    checks.set(steer.id, started);
    return started;
  };
  const gate = async (steer: SteerMessage, round: number): Promise<SteerGate> => {
    const check = await checked(steer);
    checks.delete(steer.id);
    if (check.kind === "aborted") {
      return check;
    }
    if (check.kind === "passed") {
      const note = note_of(identity, "UserPromptSubmit", check.runs, round);
      return { kind: "deliver", notes: note ? [note] : [] };
    }
    identity.emit({ type: "notice", round, notice: "hook", text: hook_notice_text({ event: "UserPromptSubmit", runs: check.runs, prompt: steer.text }), steer_id: steer.id });
    return { kind: "blocked" };
  };
  return { check_steer: checked, steer: gate };
};

const call_input = (identity: HookIdentity, event: HookEvent, call: HookCall) => ({ ...common_input(identity, event), ...tool_target(call.name, call.args, identity.mcp_server), tool_use_id: call.tool_use_id });

const pre_tool = async (identity: HookIdentity, call: HookCall): Promise<PreToolGate> => {
  const input = call_input(identity, "PreToolUse", call);
  const fired = await fire_hooks(identity, "PreToolUse", input.tool_name, input);
  if (fired.aborted) {
    return { kind: "aborted" };
  }
  return fired.blocks.length ? { kind: "blocked", text: blocked_tool_text(fired.blocks), runs: fired.runs } : { kind: "run", runs: fired.runs };
};

const post_tool = async (identity: HookIdentity, call: HookCall, end: HookToolEnd): Promise<PostToolGate> => {
  const event: HookEvent = end.status === "done" ? "PostToolUse" : "PostToolUseFailure";
  const base = call_input(identity, event, call);
  const result = end.status === "done" ? { tool_response: { status: end.status, text: end.text, view: end.view } } : { error: end.text };
  const fired = await fire_hooks(identity, event, base.tool_name, { ...base, ...result, duration_ms: end.duration_ms });
  if (fired.aborted) {
    return { kind: "aborted" };
  }
  const feedback = post_tool_feedback(event, fired.runs);
  return { kind: "done", result_text: feedback ? with_feedback(feedback, end.text) : end.text, runs: fired.runs };
};

const stop = async (identity: HookIdentity, round: number, last_text: string, active: boolean): Promise<StopGate> => {
  const event: HookEvent = identity.agent ? "SubagentStop" : "Stop";
  const input = { ...common_input(identity, event), stop_hook_active: active, last_assistant_message: last_text };
  const fired = await fire_hooks(identity, event, identity.agent?.profile ?? null, input);
  if (fired.aborted) {
    return { kind: "aborted" };
  }
  const asked = fired.blocks.length > 0 || fired.contexts.length > 0;
  const note = note_of(identity, event, fired.runs, round);
  return asked && note ? { kind: "continue", note } : { kind: "end" };
};

const stop_failure = async (identity: HookIdentity, round: number, error: TurnError): Promise<void> => {
  const input = { ...common_input(identity, "StopFailure"), error: error.kind, error_details: error.message };
  const fired = await fire_hooks(identity, "StopFailure", error.kind, input);
  if (!fired.aborted) {
    note_of(identity, "StopFailure", fired.runs, round);
  }
};

const agent_start = async (identity: HookIdentity): Promise<TurnNote[]> => {
  const fired = await fire_hooks(identity, "SubagentStart", identity.agent?.profile ?? null, common_input(identity, "SubagentStart"));
  if (fired.aborted) {
    return [];
  }
  const note = note_of(identity, "SubagentStart", fired.runs, 0);
  return note ? [note] : [];
};

export const turn_hooks = (identity: HookIdentity): TurnHooks => ({
  ...(identity.agent ? { start: () => agent_start(identity) } : steer_hooks(identity)),
  pre_tool: (call) => pre_tool(identity, call),
  post_tool: (call, end) => post_tool(identity, call, end),
  stop: (round, last_text, active) => stop(identity, round, last_text, active),
  stop_failure: (round, error) => stop_failure(identity, round, error),
});

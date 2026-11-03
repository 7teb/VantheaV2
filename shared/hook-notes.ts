import type { AssistantMessage, Message, UserMessage } from "./chat.ts";
import { hook_events, type HookEvent } from "./hooks.ts";
import { shell_kinds, type ShellKind } from "./shell.ts";

export type HookRunStatus = "blocked" | "context" | "error";

export type HookFailure = "timeout" | "start" | "json";

export type HookRun = {
  hook_id: string;
  event: HookEvent;
  shell: ShellKind;
  command: string;
  status: HookRunStatus;
  text: string;
  exit_code: number | null;
  duration_ms: number;
  failure: HookFailure | null;
};

export type HookNote = { event: HookEvent; runs: HookRun[]; prompt?: string };

export const hook_notice_marker = "[HOOK EVENT]";

const run_statuses: readonly HookRunStatus[] = ["blocked", "context", "error"];

const failures: readonly HookFailure[] = ["timeout", "start", "json"];

type Raw = Record<string, unknown>;

const is_raw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

const one_of = <T extends string>(value: unknown, allowed: readonly T[]): T | null => allowed.find((entry) => entry === value) ?? null;

const coerce_run = (value: unknown): HookRun | null => {
  if (!is_raw(value)) {
    return null;
  }
  const event = one_of(value.event, hook_events);
  const shell = one_of(value.shell, shell_kinds);
  const status = one_of(value.status, run_statuses);
  const exit_code = value.exit_code === null || (typeof value.exit_code === "number" && Number.isInteger(value.exit_code)) ? value.exit_code : undefined;
  const failure = value.failure === null || value.failure === undefined ? null : one_of(value.failure, failures);
  if (!event || !shell || !status || exit_code === undefined || (value.failure !== null && value.failure !== undefined && !failure)) {
    return null;
  }
  if (typeof value.hook_id !== "string" || typeof value.command !== "string" || typeof value.text !== "string") {
    return null;
  }
  const duration_ms = typeof value.duration_ms === "number" && Number.isFinite(value.duration_ms) ? Math.max(0, value.duration_ms) : 0;
  return { hook_id: value.hook_id, event, shell, command: value.command, status, text: value.text, exit_code, duration_ms, failure };
};

export const coerce_hook_runs = (value: unknown): HookRun[] => (Array.isArray(value) ? value.flatMap((entry) => coerce_run(entry) ?? []) : []);

export const hook_notice_text = (note: HookNote): string => `${hook_notice_marker}\n${JSON.stringify(note)}`;

export const parse_hook_notice = (text: string): HookNote | null => {
  if (!text.startsWith(`${hook_notice_marker}\n`)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(hook_notice_marker.length + 1));
  } catch (error) {
    console.warn(`[hooks] a hook notice is not valid JSON (${error instanceof Error ? error.message : String(error)}): ${text.slice(0, 200)}`);
    return null;
  }
  if (!is_raw(raw) || !Array.isArray(raw.runs)) {
    return null;
  }
  const event = one_of(raw.event, hook_events);
  const runs = coerce_hook_runs(raw.runs);
  if (!event || runs.length !== raw.runs.length || (raw.prompt !== undefined && typeof raw.prompt !== "string")) {
    return null;
  }
  return { event, runs, ...(typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}) };
};

export const hook_blocked_turn = (message: Message | undefined): message is AssistantMessage =>
  message?.role === "assistant" && (message.status === "blocked" || message.status === "stopped") && message.error?.kind === "hook";

export const without_blocked_prompts = (messages: Message[]): Message[] =>
  messages.filter((message, at) => !hook_blocked_turn(message) && !(message.role === "user" && hook_blocked_turn(messages[at + 1])));

export const passed_prompts = (messages: Message[]): UserMessage[] =>
  without_blocked_prompts(messages).filter((message): message is UserMessage => message.role === "user");

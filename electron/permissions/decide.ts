import { randomUUID } from "node:crypto";
import type { HumanDecision } from "../../shared/approval.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import type { ReviewNote, ReviewRaise, ReviewRecord } from "../../shared/review.ts";
import { shell_run_tools, type ShellKind } from "../../shared/shell.ts";
import { bash_env } from "../shell/git-bash.ts";
import type { Reviewer, ToolProfile } from "../tools/types.ts";
import { read_only_command } from "./allowlist.ts";
import { approved_with_source, prefix_grants } from "./decisions.ts";
import { floor_reason } from "./floor.ts";
import { covering_prefixes, suggest_prefix } from "./grants.ts";
import { review_verdict } from "./review-verdict.ts";
import type { PinChange, ScriptPin } from "./source-read.ts";
import { inspect_command_sources, type CommandSources } from "./sources.ts";
import type { Dialect } from "./statements.ts";
import { deny_text, workaround_text } from "./verdict-text.ts";

export type CommandInput = {
  command: string;
  background: boolean;
  mode: PermissionMode;
  app_root: string;
  project_root: string;
  cwd: string;
  plan: boolean;
  chat_id: string;
  chat_started_at: number;
  call_id: string;
  profile: ToolProfile;
  custom_instructions: string;
  delegated_task?: string;
  decisions: HumanDecision[];
  last_human_id: string | null;
  changed: PinChange[];
  shell: Dialect;
};

export type CommandDecision = {
  action: "run" | "ask" | "block" | "deny";
  reason: string;
  record: ReviewRecord | null;
  note: ReviewNote | null;
  grant_prefix: string | null;
  plan: boolean;
  pins: ScriptPin[];
  source_hash: string;
  seen: ReadonlySet<string>;
};

const nothing_seen: ReadonlySet<string> = new Set();

export const review_note = (record: ReviewRecord, detail: Pick<ReviewNote, "script_floor"> = {}): ReviewNote => ({
  id: record.id,
  source: record.source,
  reason: record.reason,
  rule_source: record.rule_source,
  rule: record.rule,
  ...(record.raised_by ? { raised_by: record.raised_by } : {}),
  ...(record.granted ? { granted: record.granted } : {}),
  ...(record.circumvents ? { circumvents: record.circumvents } : {}),
  ...(record.failure ? { failure: record.failure } : {}),
  ...detail,
});

const shell_of = (dialect: Dialect): ShellKind => (dialect === "posix" ? "bash" : "powershell");

const tool_name = (input: Pick<CommandInput, "background" | "shell">) => (input.background ? "start_background_task" : shell_run_tools[shell_of(input.shell)]);

const command_sources = (input: CommandInput): Promise<CommandSources> =>
  inspect_command_sources(input.project_root, input.cwd, input.command, {
    chat_id: input.chat_id,
    chat_started_at: input.chat_started_at,
    shell: input.shell,
    app_root: input.app_root,
    ...(input.shell === "posix" ? { env: bash_env(process.env) } : {}),
  });

const floor_block = (input: CommandInput, reviewer: Reviewer, reason: string): CommandDecision => ({
  action: "block",
  reason,
  record: {
    id: randomUUID(),
    at: Date.now(),
    actor: reviewer.actor,
    tool: tool_name(input),
    subject: input.command,
    cwd: input.cwd,
    verdict: "deny",
    source: "floor",
    reason,
    rule_source: "none",
    rule: "",
    last_human_id: input.last_human_id,
  },
  note: null,
  grant_prefix: null,
  plan: false,
  pins: [],
  source_hash: "",
  seen: nothing_seen,
});

const without_model = (action: CommandDecision["action"], plan: boolean, sources: CommandSources | null): CommandDecision => ({
  action,
  reason: "",
  record: null,
  note: null,
  grant_prefix: null,
  plan,
  pins: sources?.pins ?? [],
  source_hash: sources?.hash ?? "",
  seen: nothing_seen,
});

export const decide_command = async (input: CommandInput, reviewer: Reviewer, signal: AbortSignal, on_review?: () => void): Promise<CommandDecision> => {
  signal.throwIfAborted();
  const command = input.command.trim();
  if (!command) {
    return floor_block(input, reviewer, "The command is empty.");
  }
  const floor = floor_reason(command, { app_root: input.app_root, project_root: input.project_root, cwd: input.cwd }, input.shell);
  if (floor) {
    return floor_block(input, reviewer, floor);
  }
  const plan_change = input.plan && !read_only_command(command, input.shell);
  if (input.mode === "full") {
    return without_model(plan_change ? "ask" : "run", plan_change, null);
  }
  const sources = await command_sources(input);
  signal.throwIfAborted();
  if (input.mode === "ask") {
    return without_model("ask", plan_change, sources);
  }
  const approved_sources = approved_with_source(input.decisions, command, sources.hash, shell_of(input.shell));
  const raised: ReviewRaise[] = [
    ...(plan_change ? (["plan"] as const) : []),
    ...(sources.catastrophic.length && !approved_sources ? (["script_floor"] as const) : []),
  ];
  const prefixes = covering_prefixes(command, prefix_grants(input.decisions, shell_of(input.shell)), input.shell);
  on_review?.();
  const verdict = await review_verdict({
    reviewer,
    raised,
    granted: prefixes.length > 0,
    signal,
    input: {
      chat_id: input.chat_id,
      chat_started_at: input.chat_started_at,
      project_root: input.project_root,
      custom_instructions: input.custom_instructions,
      actor: reviewer.actor,
      profile: reviewer.actor.kind === "agent" ? input.profile : null,
      delegated_task: input.delegated_task ?? null,
      decisions: input.decisions,
      call_id: input.call_id,
      action: { tool: tool_name(input), cwd: input.cwd, background: input.background, subject: command, call: { kind: "command" }, files: sources.files, gaps: sources.gaps, changed: input.changed, programs: sources.programs, notes: sources.notes, shell: input.shell },
    },
  });
  const record = verdict.record.granted ? { ...verdict.record, grant_prefixes: prefixes } : verdict.record;
  const action = record.verdict === "allow" ? "run" : record.verdict === "deny" ? "deny" : "ask";
  const reason = action !== "deny" ? "" : record.earlier ? workaround_text("command", record, record.earlier) : deny_text("command", record);
  const prefix_option = action === "ask" && record.source === "model" && !record.raised_by?.length;
  return {
    action,
    reason,
    record,
    note: review_note(record, record.raised_by?.includes("script_floor") ? { script_floor: sources.catastrophic } : {}),
    grant_prefix: prefix_option ? suggest_prefix(command, input.shell) : null,
    plan: plan_change,
    pins: sources.pins,
    source_hash: sources.hash,
    seen: verdict.seen,
  };
};

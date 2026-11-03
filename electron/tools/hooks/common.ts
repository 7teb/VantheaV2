import type { ApprovalDecision, ApprovalRequest, HookCardScope } from "../../../shared/approval.ts";
import { hook_events, matcher_targets, type HookAction, type HookFields, type HookScope, type ScopedHook } from "../../../shared/hooks.ts";
import { shell_labels } from "../../../shared/shell.ts";
import { chat_hooks } from "../../hooks/store.ts";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { note_reason, unanswered_text } from "../../permissions/verdict-text.ts";
import { find_project } from "../../settings/store.ts";
import { folder_name } from "../../storage/paths.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const hook_reference = [
  "A hook is a shell command VantheaX runs automatically at a fixed point of a turn, in the chat's project folder, with the event as one JSON object on stdin (session_id, turn_id, hook_event_name, cwd, project_path, permission_mode, plan_mode, agent_type and, for sub-agents, agent_id and agent_name, plus the event's own fields).",
  `Events: ${hook_events.join(", ")}.`,
  "UserPromptSubmit runs for every message the user sends and every steer, not for turns the app starts itself (fields prompt, origin); PreToolUse before a tool call runs, PostToolUse after it succeeded, PostToolUseFailure after it failed (fields tool_name, tool_input, tool_use_id, and tool_response or error with duration_ms); Stop and SubagentStop when the main agent or a sub-agent is about to finish (stop_hook_active, last_assistant_message); StopFailure when a turn ends with an error (error, error_details); SubagentStart when a sub-agent starts.",
  "The matcher selects tool names for the tool events (run_command, run_bash, read_file, write_file, replace_in_file and the other VantheaX tool names; an MCP call is matched as mcp__<server>__<tool>), the agent type (explore, worker) for SubagentStart and SubagentStop, and the error kind for StopFailure; UserPromptSubmit and Stop ignore it. Empty or * matches everything, letters, digits, _, -, | and , give exact names, anything else is a JavaScript regular expression.",
  "Exit code 0 means success and its stdout is read as JSON when it is one object; exit code 2 blocks the prompt or tool call, feeds stderr to the model after a tool call, or keeps the turn going on Stop; any other exit code is a hook error that blocks nothing.",
  "JSON fields: decision \"block\" with reason (UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStop), hookSpecificOutput with hookEventName and additionalContext (UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop), and hookSpecificOutput.permissionDecision \"deny\" with permissionDecisionReason on PreToolUse.",
  "Each hook has a timeout (default 60 s); a hook that times out or cannot start never blocks anything.",
].join(" ");

export const approval_rule = "Like any other change, a hook change follows the permission mode: in ask mode it waits for the user's approval on a card, in auto and full mode the automatic review decides and may still ask the user, so never assume a change took effect until the tool result says so.";

const project_name = (path: string): string => find_project(path)?.name ?? folder_name(path);

export const card_scope = (scope: HookScope): HookCardScope => (scope.kind === "global" ? scope : { kind: "project", path: scope.path, name: project_name(scope.path) });

const scope_line = (scope: HookScope): string => (scope.kind === "global" ? "All projects" : `Project ${project_name(scope.path)} (${scope.path})`);

export const hook_line = (hook: ScopedHook | (HookFields & { id: string })): string => {
  const matcher = matcher_targets[hook.event] !== null && hook.matcher ? ` [${hook.matcher}]` : "";
  return `${hook.id} ${hook.event}${matcher} (${shell_labels[hook.shell]}, ${hook.timeout_s} s, ${hook.enabled ? "on" : "off"}): ${hook.command}`;
};

export const hooks_text = (hooks: ScopedHook[]): string => {
  const groups = new Map<string, string[]>();
  for (const hook of hooks) {
    const label = scope_line(hook.scope);
    groups.set(label, [...(groups.get(label) ?? []), hook_line(hook)]);
  }
  return [...groups].map(([label, lines]) => `${label}:\n${lines.join("\n")}`).join("\n\n");
};

export const hooks_result = (status: ToolResult["status"], action: HookAction | "list", text: string, hooks: ScopedHook[], previous: HookFields | null = null): ToolResult => ({
  status,
  text,
  view: { kind: "hooks", action, hooks, previous },
});

export const failed = (text: string): ToolResult => ({ status: "failed", text, view: null });

export const chat_hook = (project_path: string, id: string): ScopedHook | null => chat_hooks(project_path).find((hook) => hook.id === id) ?? null;

export const unknown_hook = (id: string): ToolResult =>
  failed(`No hook with id ${id.slice(0, 80)} applies to this chat. Call list_hooks to see the ids of the hooks you can change.`);

type HookRequest = Extract<ApprovalRequest, { kind: "hook" }>;

const review_subject = (request: HookRequest): string => {
  const { hook, previous } = request;
  const scope = request.scope.kind === "global" ? "all projects" : `project ${request.scope.name} (${request.scope.path})`;
  return [
    "A hook is a shell command VantheaX runs automatically, without any review, every time its event fires in its scope.",
    `action: ${request.action}`,
    `scope: ${scope}`,
    `event: ${hook.event}`,
    `matcher: ${matcher_targets[hook.event] === null ? "(none for this event)" : hook.matcher || "(all)"}`,
    `shell: ${shell_labels[hook.shell]}`,
    `timeout: ${hook.timeout_s} s`,
    `enabled: ${hook.enabled ? "yes" : "no"}`,
    `command: ${hook.command}`,
    ...(previous && previous.command !== hook.command ? [`previous command: ${previous.command}`] : []),
  ].join("\n");
};

export const approve_change = async (ctx: ToolContext, request: HookRequest): Promise<ToolResult | null> => {
  const gate = await tool_gate(ctx, request.action === "delete" ? "delete_hook" : "save_hook", review_subject(request));
  if (gate.kind === "run") {
    return null;
  }
  if (gate.kind === "denied") {
    return { status: "denied", text: gate.text, view: null };
  }
  const decision = await ctx.approve({ ...request, ...(gate.note ? { review: gate.note } : {}) });
  if (decision.expired) {
    return { status: "denied", text: unanswered_text("tool call", note_reason(gate.note)), view: null };
  }
  return decision.approved ? null : declined(decision);
};

export const declined = (decision: ApprovalDecision): ToolResult => ({
  status: "denied",
  text: `The user declined this hook change. Nothing was changed. User feedback: ${decision.feedback.trim() || "none."} Do not change hooks another way (for example by editing VantheaX's settings file) and do not propose the same change again unless the user asks for it.`,
  view: null,
});

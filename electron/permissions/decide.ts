import type { HumanDecision } from "../../shared/approval.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import type { SideModelCall } from "../tools/types.ts";
import { allowed_in_auto } from "./allowlist.ts";
import { permission_hash } from "./context.ts";
import { approved_with_source, command_tools, decisions_text, denial_reason, last_decision_for, prefix_grants, repeated_denial_text } from "./decisions.ts";
import { floor_reason } from "./floor.ts";
import { grant_covers, suggest_prefix } from "./grants.ts";
import { max_action_chars, run_review } from "./overseer.ts";
import { inspect_command_sources, type CommandSources } from "./sources.ts";

export type CommandInput = {
  command: string;
  background: boolean;
  mode: PermissionMode;
  project_root: string;
  cwd: string;
  authorization: string;
  delegated_task?: string;
  decisions: HumanDecision[];
};

export type DecisionSource =
  | "floor"
  | "full"
  | "denied_before"
  | "script"
  | "grant"
  | "mode"
  | "protected"
  | "allowlist"
  | "limit"
  | "model"
  | "cache"
  | "unavailable";

export type CommandDecision = { action: "run" | "ask" | "block" | "deny"; source: DecisionSource; reason: string; grant_prefix: string | null; source_hash: string };

const decided = (input: CommandInput, action: CommandDecision["action"], source: DecisionSource, reason: string, source_hash = ""): CommandDecision => ({
  action,
  source,
  reason,
  grant_prefix: action === "ask" && source !== "script" ? suggest_prefix(input.command) : null,
  source_hash,
});

export const command_sources = (input: CommandInput): Promise<CommandSources> => inspect_command_sources(input.project_root, input.cwd, input.command);

export const decide_command = async (input: CommandInput, side_model: SideModelCall, signal: AbortSignal): Promise<CommandDecision> => {
  signal.throwIfAborted();
  const command = input.command.trim();
  if (!command) {
    return decided(input, "block", "floor", "The command is empty.");
  }
  const floor = floor_reason(command);
  if (floor) {
    return decided(input, "block", "floor", floor);
  }
  if (input.mode === "full") {
    return decided(input, "run", "full", "Full access is on.");
  }
  const previous = last_decision_for(input.decisions, command_tools, command);
  if (previous && !previous.approved) {
    if (previous.context_hash === permission_hash(input.authorization)) {
      return decided(input, "deny", "denied_before", repeated_denial_text(previous));
    }
    return decided(input, "ask", "denied_before", denial_reason(previous));
  }
  const sources = await command_sources(input);
  signal.throwIfAborted();
  if (sources.catastrophic.length && !approved_with_source(input.decisions, command, sources.hash)) {
    return decided(input, "ask", "script", `A script this command runs contains a destructive system operation: ${sources.catastrophic.join("; ")}`, sources.hash);
  }
  if (grant_covers(command, prefix_grants(input.decisions))) {
    return decided(input, "run", "grant", "Covered by your earlier \"don't ask again\" approval.", sources.hash);
  }
  if (input.mode === "ask") {
    return decided(input, "ask", "mode", "Ask mode confirms every command.", sources.hash);
  }
  if (sources.protected_read) {
    return decided(input, "ask", "protected", "This command reads credential or key files.", sources.hash);
  }
  if (allowed_in_auto(command)) {
    return decided(input, "run", "allowlist", "Read-only command.", sources.hash);
  }
  if (command.length > max_action_chars) {
    return decided(input, "ask", "limit", "The command is too long for the safety check.", sources.hash);
  }
  const review = await run_review(
    side_model,
    {
      action: input.background ? `${command}\n(started as a background task)` : command,
      project_root: input.project_root,
      cwd: input.cwd,
      authorization: input.authorization,
      sources: sources.text,
      delegated_task: input.delegated_task,
      decisions: decisions_text(input.decisions),
    },
    signal,
  );
  return decided(input, review.verdict.safe ? "run" : "ask", review.source, review.verdict.reason, sources.hash);
};

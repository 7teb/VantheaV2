import path from "node:path";
import type { OverseerVerdict, PermissionCheck } from "../../shared/approval.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import { error_text } from "../storage/coerce.ts";
import type { SideModelCall } from "../tools/types.ts";
import { allowed_in_auto } from "./allowlist.ts";
import { permission_hash } from "./context.ts";
import { floor_reason } from "./floor.ts";
import { grant_covers, grant_hint, suggest_prefix, type GrantContext } from "./grants.ts";
import { build_overseer_messages, overseer_input_reason, parse_overseer_verdict } from "./overseer.ts";
import { inspect_command_sources, type CommandSources } from "./sources.ts";

export type CommandInput = {
  command: string; mode: PermissionMode; chat_id: string; project_root: string; intent: string;
  cwd?: string; delegated_task?: string; sources?: CommandSources;
};
export type CommandDecision = {
  action: "run" | "ask" | "block"; reason: string; source: PermissionCheck["source"];
  context: GrantContext; verdict: OverseerVerdict | null; grant_prefix: string | null;
};

const cache = new WeakMap<SideModelCall, Map<string, OverseerVerdict>>();
const overseer_timeout_ms = 8000;
const overseer_max_tokens = 200;

export const command_context = (input: CommandInput, source_hash: string): GrantContext => ({
  authorization_hash: permission_hash(input.intent + "\0" + (input.delegated_task ?? "")), cwd: path.resolve(input.cwd || input.project_root || "."),
  source_hash, command_hash: permission_hash(input.command.trim()),
});

const result = (input: CommandInput, context: GrantContext, action: CommandDecision["action"], source: PermissionCheck["source"],
  reason: string, verdict: OverseerVerdict | null = null): CommandDecision =>
  ({ action, source, reason, context, verdict, grant_prefix: action === "ask" ? suggest_prefix(input.command) : null });

export const prepare_command_review = async (input: CommandInput): Promise<{ sources: CommandSources; context: GrantContext }> => {
  const sources = input.sources ?? await inspect_command_sources(input.project_root, input.cwd || input.project_root, input.command);
  return { sources, context: command_context(input, sources.hash) };
};

export const decide_command = async (input: CommandInput, side_model: SideModelCall, signal: AbortSignal): Promise<CommandDecision> => {
  signal.throwIfAborted();
  const command = input.command.trim();
  const base = command_context(input, "");
  if (!command) return result(input, base, "block", "floor", "The command is empty.");
  const floor = floor_reason(command);
  if (floor) return result(input, base, "block", "floor", floor);
  if (input.mode === "full") return result(input, base, "run", "full", "The user selected full access.");
  const { sources, context } = await prepare_command_review(input);
  signal.throwIfAborted();
  const query = { chat_id: input.chat_id, project_root: input.project_root, command, context };
  if (sources.complete && grant_covers(query)) return result(input, context, "run", "grant", "The same command, source and authorization were already approved.");
  if (input.mode === "ask") return result(input, context, "ask", "mode", "Ask mode requires a user approval.");
  if (sources.protected_read) return result(input, context, "ask", "protected", "This command reads protected or credential files; a specific user approval is required.");
  const limit = overseer_input_reason(command, input.intent, sources.text);
  if (limit || (input.delegated_task?.length ?? 0) > 24000) {
    return result(input, context, "ask", "limit", limit ?? "The complete delegated task exceeds the review limit.");
  }
  if (!sources.complete) return result(input, context, "ask", "incomplete", "The actual script or project instructions could not be inspected completely.");
  const messages = build_overseer_messages(command, input.intent, sources.text, {
    project_root: input.project_root, cwd: context.cwd, approvals: grant_hint(query), delegated_task: input.delegated_task, complete: sources.complete,
  });
  const model_id = await side_model.model_id?.("overseer") ?? "";
  const key = permission_hash(JSON.stringify({ messages, context, model_id }));
  const bucket = cache.get(side_model) ?? new Map<string, OverseerVerdict>();
  cache.set(side_model, bucket);
  const cached = bucket.get(key);
  if (cached) return result(input, context, cached.safe ? "run" : "ask", allowed_in_auto(command) ? "allowlist" : "cache", cached.reason, cached);
  try {
    const answer = await side_model("overseer", messages, overseer_max_tokens, AbortSignal.any([signal, AbortSignal.timeout(overseer_timeout_ms)]));
    const verdict = parse_overseer_verdict(answer);
    bucket.set(key, verdict);
    if (bucket.size > 256) bucket.delete(bucket.keys().next().value!);
    return result(input, context, verdict.safe ? "run" : "ask", "model", verdict.reason, verdict);
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn("[permissions] complete command review failed: " + error_text(error));
    const verdict = { safe: false, reason: "The overseer is unavailable; user approval is required." };
    return result(input, context, "ask", "unavailable", verdict.reason, verdict);
  }
};

import type { HumanDecision } from "../../shared/approval.ts";
import type { McpTier } from "../../shared/approval.ts";
import type { ToolStep } from "../../shared/chat.ts";
import type { ReviewActor, ReviewRecord } from "../../shared/review.ts";
import { human_requests_of, last_human_id } from "./context.ts";
import { agent_edits, instruction_snapshot } from "./instruction-files.ts";
import { read_profile } from "./project-profile.ts";
import type { ReviewInput } from "./review-request.ts";
import { chat_fold_key, stored_profile } from "./review-state.ts";
import type { PinChange } from "./source-read.ts";
import type { ScriptFile } from "./sources.ts";
import { command_targets, run_git, target_facts, type GitRunner } from "./target-facts.ts";

export type InputRequest = {
  chat_id: string;
  project_root: string;
  custom_instructions: string;
  actor: ReviewActor;
  profile: string | null;
  delegated_task: string | null;
  records: ReviewRecord[];
  decisions: HumanDecision[];
  steps: ToolStep[];
  earlier_commands: number;
  call_id: string;
  action: {
    tool: string;
    cwd: string;
    background: boolean;
    subject: string;
    mcp: { tier: McpTier; trusted: boolean } | null;
    files: ScriptFile[];
    gaps: string[];
    changed: PinChange[];
  };
};

export const review_input = async (request: InputRequest, git: GitRunner = run_git): Promise<ReviewInput> => {
  const humans = human_requests_of(request.chat_id);
  const chat_key = chat_fold_key(humans, request.custom_instructions);
  const profile = stored_profile(request.chat_id, chat_key) ?? (await read_profile(request.project_root));
  const snapshot = await instruction_snapshot(request.chat_id, request.project_root, humans);
  const edits = await agent_edits(request.chat_id, request.project_root);
  const facts = request.action.mcp ? [] : await target_facts(await command_targets(request.action.subject, request.action.cwd, request.action.files), git);
  return {
    chat: { chat_id: request.chat_id, project_root: request.project_root, custom_instructions: request.custom_instructions, humans, profile, snapshot },
    chat_key,
    agent: { actor: request.actor, profile: request.profile, delegated_task: request.delegated_task, earlier_commands: request.earlier_commands },
    source: { records: request.records, decisions: request.decisions, steps: request.steps },
    mark: last_human_id(request.chat_id),
    call_id: request.call_id,
    action: { ...request.action, edits: { text: edits.text, since: snapshot.number }, facts },
  };
};

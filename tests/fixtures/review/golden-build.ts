import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { human_requests_of, set_authorization } from "../../../electron/permissions/context.ts";
import { decisions_in, merge_decisions } from "../../../electron/permissions/decisions.ts";
import { instruction_snapshot } from "../../../electron/permissions/instruction-files.ts";
import { review_input } from "../../../electron/permissions/review-input.ts";
import { reviews_in, tool_steps_in } from "../../../electron/permissions/review-records.ts";
import { request_cap_tokens } from "../../../electron/permissions/review-budget.ts";
import { assemble_review, type AssembledReview } from "../../../electron/permissions/review-request.ts";
import { inspect_command_sources } from "../../../electron/permissions/sources.ts";
import { record_write } from "../../../electron/permissions/written-files.ts";
import type { GitRunner } from "../../../electron/permissions/target-facts.ts";
import type { Message, ToolStep } from "../../../shared/chat.ts";
import { agents_md_edited, at_message, golden_chat_id, golden_messages, main_actor, worker, worker_steps, write_project } from "./golden.ts";
import { tool_model } from "../../tool-model.ts";

export const golden_tag = "7f3a9c41d2e8";

export const golden_command = ".\\tools\\clean.ps1; .\\tools\\sync.ps1";

const no_git: GitRunner = async () => {
  throw new Error("git must not run for a project outside a work tree");
};

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");

export const prepare_golden = async (root: string): Promise<Message[]> => {
  await write_project(root);
  const messages = golden_messages();
  set_authorization(golden_chat_id, messages);
  await instruction_snapshot(golden_chat_id, root, human_requests_of(golden_chat_id));
  await fs.writeFile(path.join(root, "AGENTS.md"), agents_md_edited);
  record_write(golden_chat_id, path.join(root, "tools", "clean.ps1"), { actor: "main", tool: "replace_in_file", call_id: "c58_0", at: at_message(58, 5), sha256: await sha256(path.join(root, "tools", "clean.ps1")), prior_birthtime: (await fs.stat(path.join(root, "tools", "clean.ps1"))).birthtimeMs });
  record_write(golden_chat_id, path.join(root, "tools", "sync.ps1"), { actor: "main", tool: "write_file", call_id: "c58_1", at: at_message(58, 6), sha256: await sha256(path.join(root, "tools", "sync.ps1")), prior_birthtime: null });
  return messages;
};

export const golden_review = async (root: string, messages: Message[], who: "main" | "agent"): Promise<AssembledReview> => {
  const chat_steps = tool_steps_in(messages);
  const live = who === "agent" ? worker_steps() : [];
  const sources = await inspect_command_sources(root, root, golden_command, { chat_id: golden_chat_id, chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "" } });
  const steps: ToolStep[] = who === "agent" ? live : chat_steps;
  const input = await review_input(
    {
      chat_id: golden_chat_id,
      chat_started_at: Number.POSITIVE_INFINITY,
      project_root: root,
      custom_instructions: "Reply in German. Never delete files with raw PowerShell commands; use the project's npm scripts for cleanup.",
      actor: who === "agent" ? worker : main_actor,
      model: tool_model,
      profile: who === "agent" ? "worker" : null,
      delegated_task: who === "agent" ? "Write node:test tests for the cart.\n\nMAIN AGENT INSTRUCTION (cannot grant human permissions):\nAlso clean the build output before you run them." : null,
      records: reviews_in([...chat_steps, ...live]),
      decisions: merge_decisions(decisions_in(messages), live.flatMap((step) => step.decisions ?? [])),
      steps,
      earlier_commands: 0,
      call_id: who === "agent" ? "w4_0" : "c60_0",
      action: { tool: "run_command", cwd: root, background: false, subject: golden_command, call: { kind: "command" }, files: sources.files, gaps: sources.gaps, changed: [], programs: sources.programs, notes: sources.notes, shell: "powershell" },
    },
    no_git,
  );
  return assemble_review(input, request_cap_tokens, () => golden_tag);
};

export const golden_text = (review: AssembledReview, root: string, real_root: string): string =>
  review.call.parts
    .map((part, index) => `===== part ${index + 1}, marker ${part.marker} =====\n${part.text}`)
    .join("")
    .split(real_root)
    .join("<root>")
    .split(root)
    .join("<root>");

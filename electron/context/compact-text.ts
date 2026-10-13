import { removed_output_stub, type RemovedOutput } from "./window.ts";

export type CompactAudience = "user" | "agent";

type Substitution = readonly [from: string, to: string];

export const derive_text = (text: string, substitutions: readonly Substitution[]): string =>
  substitutions.reduce((out, [from, to]) => {
    if (!out.includes(from)) {
      throw new Error(`deriving a sub-agent compaction text failed: the phrase ${JSON.stringify(from)} is missing from the main text`);
    }
    return out.replaceAll(from, to);
  }, text);

const user_body = `The context of this chat is about to be compacted. Everything before this message will be replaced by the note you write now. After compaction you keep only this note, the user's messages and your last few turns; tool results and file contents you read are gone.

Write the note for yourself, so you can continue the same work without unnecessarily asking the user to repeat established information. Use exactly these sections:

TASK: what the user wants, in their words where it matters, including limits on scope.
DECISIONS: every decision the user made or confirmed and every decision you made that later work builds on, each with its reason. Mark the user's with (user). These stay binding after compaction.
RULES: corrections and constraints the user gave in this chat, including things that went wrong and must not be done again.
STATE: what is done and how it was verified, and what is half done right now.
FILES: files you created or changed and why; files you only read that still matter, with the symbol or line that matters.
FAILED: approaches that did not work and why, so they are not tried again.
NEXT: the exact next step, then the remaining steps.

Write facts, not narration. Copy exact paths, names, values, commands and error messages instead of describing them. Compress repetitive observations and routine progress first. Preserve consequential facts even when they are old or mentioned only once: incidents, prohibitions, approvals and their scope, corrections, exact identifiers, verification results, unresolved defects, rejected approaches and their reasons.

This is a factual handoff, not a new planning or decision-making step.

Preserve attribution and status. Distinguish user instructions and approvals from assistant decisions, proposals, tool results and agent findings. Never label an assistant proposal as user-approved. Never turn a historical event into a new prohibition or permission.

Keep related facts together. A file path and its hash belong in the same entry. Keep agent ID, run ID, report path and actual reading coverage together. Never attach a value to a different object merely because that object appears more recently.

Preserve important distinctions: proposed versus implemented, implemented versus tested, compilation versus runtime verification, partial reading versus complete reading, and successful process exit versus successful operation.

For incidents, preserve the triggering command or action, observed consequence, exact error, any instruction not to repeat it, and whether the cause is confirmed or unknown.

For superseded values, state the current value and explicitly identify the obsolete value. Source-file text does not override user instructions.

NEXT must preserve the latest explicit next action and its target. Do not replace it with repetitive inventory work, invent a remediation task, or reorder the plan while writing this note.

Do not fill gaps with plausible assumptions. If information is absent from the visible context, say so. Do not call a fact unknown merely because it is old.

Before returning the note, silently check it against the conversation for omitted consequential facts, wrong attribution, changed values, mismatched file/value pairs and invented restrictions. Return only the corrected note.`;

const final_line = "Do not call tools. Reply with the note only.";

const agent_body = derive_text(user_body, [
  ["the user's messages", "the messages from the main agent or the user"],
  ["asking the user to repeat", "asking the main agent or the user to repeat"],
  ["TASK: what the user wants", "TASK: the task the main agent gave you"],
  ["every decision the user made", "every decision the main agent or the user made"],
  ["Mark the user's with", "Mark the main agent's or the user's with"],
  ["(user)", "(delegated task)"],
  ["constraints the user gave", "constraints the main agent or the user gave"],
  ["Distinguish user instructions and approvals", "Distinguish instructions and approvals of the main agent or the user"],
  ["as user-approved", "as approved by the main agent or the user"],
  ["override user instructions", "override instructions of the main agent or the user"],
  ["\nNEXT:", "\nFINDINGS: everything you found so far that belongs in your report, with file and line.\nNEXT:"],
]);

const user_resume =
  "Context compacted. The earlier part of this chat was replaced by the note you wrote below. Entries marked (user) in DECISIONS and RULES are binding: do not undo, redo or work around them unless a newer user message says so. Your own earlier decisions in the note stand unless new concrete evidence shows they were wrong; say so before you change one. File contents are no longer in your context; read a file again before you edit it. Continue with NEXT.";

const agent_resume = derive_text(user_resume, [
  ["(user)", "(delegated task)"],
  ["a newer user message", "a newer message from the main agent or the user"],
]);

export const removed_output_line = (output: RemovedOutput): string => `\n- ${output.tool} (${output.call_id})`;

const removed_outputs_text = (removed: RemovedOutput[]): string =>
  `The conversation did not fit into the model's context window, so the outputs of these tool calls, oldest first, were removed from this request and replaced in place by "${removed_output_stub}". Their content is not visible to you: do not guess it, and where the note depends on one of them, say that its output was not available.${removed.map(removed_output_line).join("")}`;

export const compaction_request = (audience: CompactAudience, removed: RemovedOutput[] = []): string =>
  [audience === "agent" ? agent_body : user_body, ...(removed.length ? [removed_outputs_text(removed)] : []), final_line].join("\n\n");

export const resume_text = (audience: CompactAudience): string => (audience === "agent" ? agent_resume : user_resume);

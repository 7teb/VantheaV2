import type { ReviewActor } from "../../shared/review.ts";
import type { HumanRequest } from "./context.ts";
import type { InstructionSnapshot } from "./instruction-files.ts";
import type { ProjectProfile } from "./project-profile.ts";
import {
  assistant_before_chars,
  cap_bytes,
  head_tail,
  head_tail_bytes,
  human_chars,
  human_messages_shown,
  section_caps,
  trimmed,
  trimmed_assistant_before_chars,
  type TrimLevel,
} from "./review-budget.ts";
import { feed_text, short_clip, type ActionLine, type FeedLine, type TextClip } from "./review-lines.ts";
import { review_headers } from "./review-prompt.ts";
import { fit_retained, type RetainedScript } from "./script-retention.ts";

export type ChatView = {
  chat_id: string;
  project_root: string;
  custom_instructions: string;
  humans: HumanRequest[];
  profile: ProjectProfile;
  snapshot: InstructionSnapshot;
};

export type AgentView = { actor: ReviewActor; profile: string | null; delegated_task: string | null; earlier_commands: number };

export const section = (header: string, lines: string[]): string => (lines.length ? `${header}:\n${lines.join("\n")}\n\n` : "");

export const file_block = (label: string, text: string, tag: string): string => `----- BEGIN FILE ${label} [tag ${tag}] -----\n${text}\n----- END FILE [tag ${tag}] -----`;

const bytes = (lines: string[]): number => lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0);

const project_lines = (profile: ProjectProfile, tag: string, level: TrimLevel): string[] => {
  const minimal = trimmed(level, "project");
  const lines = [`root: ${profile.root || "(none)"}`, profile.git];
  if (!minimal && profile.listing) lines.push("top-level entries:", profile.listing);
  if (profile.scripts) lines.push(`package.json scripts: ${profile.scripts}`);
  if (!minimal && profile.readme) lines.push(file_block("README.md (first 1500 characters)", profile.readme, tag));
  return lines;
};

const instruction_lines = (snapshot: InstructionSnapshot, tag: string): string[] => {
  const lines = [snapshot.number ? `as of human message #${snapshot.number}` : "as of the start of this chat"];
  if (snapshot.after_restart) lines.push("snapshot taken after an app restart; earlier agent edits cannot be shown");
  for (const file of snapshot.files) {
    if (file.text === null) {
      lines.push(`${file.name}: not present`);
      continue;
    }
    lines.push(file_block(`${file.name} (${file.text.length} characters)`, head_tail_bytes(file.text, cap_bytes(section_caps.instruction_file)), tag));
  }
  return lines;
};

const assistant_tail = (text: string, max: number): string => (text.length <= max ? text : `[…]${text.slice(-max)}`);

const human_lines = (humans: HumanRequest[], level: TrimLevel): string[] => {
  const shown = humans.slice(-human_messages_shown);
  const omitted = humans.length - shown.length;
  const before_chars = trimmed(level, "assistant_before") ? trimmed_assistant_before_chars : assistant_before_chars;
  const lines = shown.map((entry, index) => {
    const before = entry.assistant_reference?.text.trim() ?? "";
    const body = JSON.stringify({ human: head_tail(entry.text, human_chars), ...(before ? { assistant_before: assistant_tail(before, before_chars) } : {}) });
    return `#${omitted + index + 1} ${body}`;
  });
  return [...(omitted ? [`(${omitted} older human messages are not shown. Missing messages grant nothing.)`] : []), ...lines];
};

export const chat_part = (view: ChatView, tag: string, level: TrimLevel): string =>
  [
    section(review_headers.project, project_lines(view.profile, tag, level)),
    section(review_headers.custom_instructions, view.custom_instructions.trim() ? [JSON.stringify(view.custom_instructions.trim())] : []),
    section(review_headers.instruction_files, instruction_lines(view.snapshot, tag)),
    section(review_headers.human_messages, human_lines(view.humans, level)),
  ].join("");

const reviewed_agent = (view: AgentView): string =>
  view.actor.kind === "main" ? "main agent" : `sub-agent ${view.actor.name} (${view.profile ?? "worker"} profile, id ${view.actor.id}), deployed by the main agent`;

export const decision_lines = (feed: FeedLine[], level: TrimLevel): string[] => {
  const cap = cap_bytes(section_caps.earlier_decisions);
  const old_allows = new Set(feed.filter((line) => line.own_allow).slice(0, -20).map((line) => line.key));
  const recent = new Set(feed.slice(-20).map((line) => line.key));
  const build = (stage: number) => {
    const kept = stage >= 1 ? feed.filter((line) => !old_allows.has(line.key)) : feed;
    const dropped = feed.length - kept.length;
    const lines = kept.map((line) => (stage >= 3 || (stage >= 2 && !recent.has(line.key)) ? JSON.stringify(clipped(line, short_clip)) : feed_text(line)));
    return [...(dropped ? [`(${dropped} earlier allowed actions of this agent not shown)`] : []), ...lines];
  };
  let stage = trimmed(level, "decision_text") ? 3 : trimmed(level, "own_allows") ? 1 : 0;
  let lines = build(stage);
  while (bytes(lines) > cap && stage < 3) {
    stage += 1;
    lines = build(stage);
  }
  return lines;
};

const clipped = (line: FeedLine, clip: TextClip): Record<string, unknown> => ({
  ...line.fields,
  action: head_tail(line.action, clip.action),
  reason: String(line.fields.reason ?? "").slice(0, clip.reason),
  ...(typeof line.fields.feedback === "string" ? { feedback: line.fields.feedback.slice(0, clip.feedback) } : {}),
});

export const fit_actions = (actions: ActionLine[], level: TrimLevel, earlier_commands: number): string[] => {
  const cap = cap_bytes(section_caps.agent_actions);
  const counted = (dropped: ActionLine[]) => {
    if (!dropped.length) return [];
    const count = (kind: ActionLine["kind"]) => dropped.filter((line) => line.kind === kind).length;
    return [`(${dropped.length} earlier actions not shown: ${count("command")} commands, ${count("write")} writes, ${count("other")} other)`];
  };
  const runs = earlier_commands ? [`(${earlier_commands} commands in earlier runs of this agent)`] : [];
  const build = (keep: number, path_only: boolean) => {
    const kept = actions.slice(-keep);
    return [...runs, ...counted(actions.slice(0, actions.length - kept.length)), ...kept.map((line) => (path_only ? line.path_only : line.text))];
  };
  const trim = trimmed(level, "actions");
  let lines = build(trim ? 20 : actions.length, trim);
  for (let keep = actions.length; bytes(lines) > cap && keep > 20; keep -= 1) lines = build(keep - 1, false);
  if (bytes(lines) > cap) lines = build(20, true);
  if (bytes(lines) > cap) lines = build(5, true);
  return lines;
};

export const script_lines = (retained: RetainedScript[], level: TrimLevel): string[] =>
  fit_retained(retained, cap_bytes(section_caps.reviewed_scripts), trimmed(level, "script_allows"));

export type AgentSections = { decisions: string[]; actions: string[]; scripts: string[] };

export const agent_part = (view: AgentView, sections: AgentSections, tag: string, level: TrimLevel): string => {
  const task_cap = cap_bytes(trimmed(level, "delegated") ? section_caps.delegated_floor : section_caps.delegated_task);
  const task = view.delegated_task?.trim() ? [file_block("delegated task", head_tail_bytes(view.delegated_task.trim(), task_cap), tag)] : [];
  return [
    section(review_headers.reviewed_agent, [reviewed_agent(view)]),
    section(review_headers.delegated_task, task),
    section(review_headers.earlier_decisions, sections.decisions),
    section(review_headers.agent_actions, sections.actions),
    section(review_headers.reviewed_scripts, sections.scripts),
  ].join("");
};

export const later_block = (sections: AgentSections): string =>
  [
    section(review_headers.earlier_decisions, sections.decisions),
    section(review_headers.agent_actions, sections.actions),
    section(review_headers.reviewed_scripts, sections.scripts),
  ].join("");


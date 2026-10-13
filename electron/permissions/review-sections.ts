import type { ReviewActor } from "../../shared/review.ts";
import type { HumanRequest } from "./context.ts";
import type { InstructionSnapshot } from "./instruction-files.ts";
import type { ProjectProfile } from "./project-profile.ts";
import {
  cap_bytes,
  head_tail,
  head_tail_bytes,
  human_chars,
  older_human_chars,
  recent_human_messages,
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

const bytes_each = (lines: string[]): number[] => lines.map((line) => Buffer.byteLength(line) + 1);

const bytes = (lines: string[]): number => bytes_each(lines).reduce((total, size) => total + size, 0);

const project_lines = (profile: ProjectProfile, tag: string, level: TrimLevel): string[] => {
  const minimal = trimmed(level, "project");
  const lines = [`root: ${profile.root || "(none)"}`, profile.git];
  if (!minimal && profile.listing) lines.push("top-level entries:", profile.listing);
  if (profile.scripts) lines.push(`package.json scripts: ${profile.scripts}`);
  if (!minimal && profile.readme) lines.push(file_block(`README.md (${profile.readme.length} characters)`, profile.readme, tag));
  return lines;
};

const instruction_lines = (snapshot: InstructionSnapshot, tag: string, level: TrimLevel): string[] => {
  const capped = trimmed(level, "project");
  const lines = [snapshot.number ? `as of human message #${snapshot.number}` : "as of the start of this chat"];
  if (snapshot.after_restart) lines.push("snapshot taken after an app restart; earlier agent edits cannot be shown");
  for (const file of snapshot.files) {
    if (file.text === null) {
      lines.push(`${file.name}: not present`);
      continue;
    }
    lines.push(file_block(`${file.name} (${file.text.length} characters)`, capped ? head_tail_bytes(file.text, cap_bytes(section_caps.instruction_file)) : file.text, tag));
  }
  return lines;
};

const assistant_tail = (text: string, max: number): string => (text.length <= max ? text : `[…]${text.slice(-max)}`);

const human_lines = (humans: HumanRequest[], level: TrimLevel, dropped: number): string[] => {
  const clip_before = trimmed(level, "assistant_before");
  const clip_humans = trimmed(level, "older_humans");
  const lines = humans.map((entry, index) => {
    const before = entry.assistant_reference?.text.trim() ?? "";
    const chars = index < humans.length - recent_human_messages ? older_human_chars : human_chars;
    const human = clip_humans ? head_tail(entry.text, chars) : entry.text;
    const body = JSON.stringify({ human, ...(before ? { assistant_before: clip_before ? assistant_tail(before, trimmed_assistant_before_chars) : before } : {}) });
    return `#${index + 1} ${body}`;
  });
  const note = `(The ${dropped} oldest human messages are not shown: the review request is at its size cap. Missing messages grant nothing.)`;
  return [...(dropped ? [note] : []), ...lines.slice(dropped)];
};

export const human_line_bytes = (humans: HumanRequest[], level: TrimLevel): number[] => bytes_each(human_lines(humans, level, 0));

export const chat_part = (view: ChatView, tag: string, level: TrimLevel, dropped_humans: number): string =>
  [
    section(review_headers.project, project_lines(view.profile, tag, level)),
    section(review_headers.custom_instructions, view.custom_instructions.trim() ? [JSON.stringify(view.custom_instructions.trim())] : []),
    section(review_headers.instruction_files, instruction_lines(view.snapshot, tag, level)),
    section(review_headers.human_messages, human_lines(view.humans, level, dropped_humans)),
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
  if (!trimmed(level, "own_allows")) {
    return build(0);
  }
  let stage = trimmed(level, "decision_text") ? 3 : 1;
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
  if (!trimmed(level, "actions")) {
    return [...runs, ...actions.map((line) => line.full)];
  }
  let lines = build(20, true);
  for (let keep = actions.length; bytes(lines) > cap && keep > 20; keep -= 1) lines = build(keep - 1, false);
  if (bytes(lines) > cap) lines = build(20, true);
  if (bytes(lines) > cap) lines = build(5, true);
  return lines;
};

export const script_lines = (retained: RetainedScript[], level: TrimLevel): string[] => {
  const trim = trimmed(level, "script_allows");
  return fit_retained(retained, trim ? cap_bytes(section_caps.reviewed_scripts) : Number.POSITIVE_INFINITY, trim);
};

export type AgentSections = { decisions: string[]; actions: string[]; scripts: string[] };

export const agent_part = (view: AgentView, sections: AgentSections, tag: string, level: TrimLevel): string => {
  const task_text = view.delegated_task?.trim() ?? "";
  const task = task_text ? [file_block("delegated task", trimmed(level, "delegated") ? head_tail_bytes(task_text, cap_bytes(section_caps.delegated_floor)) : task_text, tag)] : [];
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


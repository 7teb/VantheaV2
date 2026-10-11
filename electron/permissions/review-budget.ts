import type { ScriptFile } from "./sources.ts";
import { send_candidate } from "./sources.ts";

export const request_cap_tokens = 200000;

export const section_caps = {
  system: 10000,
  project: 3000,
  custom_instructions: 8000,
  instruction_file: 35000,
  reviewed_agent: 200,
  delegated_task: 25000,
  delegated_floor: 6000,
  earlier_decisions: 30000,
  agent_actions: 20000,
  reviewed_scripts: 6000,
  later_blocks: 16000,
  scripts_run: 60000,
  inspection_gaps: 2000,
  agent_edits: 8000,
  target_facts: 2000,
} as const;

export const max_later_blocks = 40;

export const human_messages_shown = 50;

export const human_chars = 12000;

export const assistant_before_chars = 1000;

export const trimmed_assistant_before_chars = 200;

export const trim_steps = ["agent_fold", "actions", "own_allows", "script_allows", "project", "delegated", "decision_text", "assistant_before", "scripts_run"] as const;

export type TrimStep = (typeof trim_steps)[number];

export type TrimLevel = number;

export const trimmed = (level: TrimLevel, step: TrimStep): boolean => level > trim_steps.indexOf(step);

export const estimate_review_tokens = (text: string): number => Math.ceil(Buffer.byteLength(text, "utf8") / 2);

export const cap_bytes = (tokens: number): number => tokens * 2;

export const head_tail = (text: string, max_chars: number): string => {
  if (text.length <= max_chars) {
    return text;
  }
  const head = Math.floor(max_chars * 0.7);
  const tail = Math.floor(max_chars * 0.3);
  return `${text.slice(0, head)}\n[${text.length - head - tail} characters omitted]\n${text.slice(-tail)}`;
};

export const head_tail_bytes = (text: string, max_bytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= max_bytes) {
    return text;
  }
  const ratio = max_bytes / Buffer.byteLength(text, "utf8");
  return head_tail(text, Math.max(1, Math.floor(text.length * ratio) - 64));
};

export type ScriptFit = { sent: Set<string>; gaps: string[]; over_budget: Set<string> };

export const fit_scripts = (files: ScriptFile[], budget_tokens: number = section_caps.scripts_run, dropped: ReadonlySet<string> = new Set()): ScriptFit => {
  const sent = new Set<string>();
  const over_budget = new Set<string>();
  const gaps: string[] = [];
  let left = budget_tokens;
  for (const file of files) {
    if (!send_candidate(file)) {
      continue;
    }
    const tokens = estimate_review_tokens(file.text ?? "");
    if (tokens <= left && !dropped.has(file.id)) {
      sent.add(file.id);
      left -= tokens;
      continue;
    }
    over_budget.add(file.id);
    const name = file.path || "encoded payload";
    gaps.push(`Script not sent, over the review budget: ${name} (${file.chars.toLocaleString("en-US")} characters, about ${tokens.toLocaleString("en-US")} tokens, ${left.toLocaleString("en-US")} of ${budget_tokens.toLocaleString("en-US")} tokens left).`);
  }
  return { sent, gaps, over_budget };
};

export const largest_sent = (files: ScriptFile[], sent: ReadonlySet<string>): ScriptFile | null =>
  files.filter((file) => sent.has(file.id)).sort((a, b) => b.chars - a.chars)[0] ?? null;

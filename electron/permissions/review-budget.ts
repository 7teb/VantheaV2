import type { RetainedScript } from "./script-retention.ts";
import type { ScriptFile } from "./sources.ts";

export const request_cap_tokens = 200000;

export const section_caps = {
  project: 3000,
  instruction_file: 35000,
  reviewed_agent: 200,
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

export const human_chars = 12000;

export const recent_human_messages = 10;

export const older_human_chars = 1500;

export const trimmed_assistant_before_chars = 200;

export const trim_steps = ["agent_fold", "actions", "own_allows", "script_allows", "project", "delegated", "decision_text", "assistant_before", "older_humans", "scripts_run"] as const;

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

export type ScriptFit = { sent: Set<string>; gaps: string[]; over_budget: Set<string>; context: Set<string>; earlier: Map<string, RetainedScript>; tokens: number };

const retained_key = (file: ScriptFile): string => `${file.path.toLowerCase()}|${file.sha256 ?? "absent"}`;

const fill_tier = (file: ScriptFile): number | null => {
  if (file.text === null) return null;
  if (file.role === "started" || file.role === "payload") return 0;
  if (file.change?.kind === "written") return 1;
  if (file.role === "manifest") return 2;
  if (file.role === "input") return 3;
  if (file.change) return 4;
  return file.role === "loaded" && !file.outside ? 5 : null;
};

const forces_review = (file: ScriptFile, tier: number): boolean => tier <= 2 || (tier === 3 && file.change !== null);

export const fit_scripts = (files: ScriptFile[], budget_tokens: number = section_caps.scripts_run, retained: RetainedScript[] = []): ScriptFit => {
  const seen = new Map(retained.filter((entry) => entry.sent).map((entry) => [entry.key, entry]));
  const earlier_of = (file: ScriptFile) => (file.path ? seen.get(retained_key(file)) : undefined);
  const order = files
    .flatMap((file) => {
      const tier = fill_tier(file);
      return tier === null ? [] : [{ file, tier, seen: earlier_of(file) !== undefined }];
    })
    .sort((a, b) => a.tier - b.tier || Number(a.seen) - Number(b.seen) || (a.tier >= 4 ? a.file.chars - b.file.chars : 0));
  const sent = new Set<string>();
  const over_budget = new Set<string>();
  const context = new Set<string>();
  const earlier = new Map<string, RetainedScript>();
  const gaps: string[] = [];
  const capped = budget_tokens < section_caps.scripts_run;
  let left = budget_tokens;
  for (const { file, tier } of order) {
    const tokens = estimate_review_tokens(file.text ?? "");
    if (tokens <= left) {
      sent.add(file.id);
      left -= tokens;
      continue;
    }
    over_budget.add(file.id);
    const before = earlier_of(file);
    if (before) earlier.set(file.id, before);
    if (before || !forces_review(file, tier)) {
      context.add(file.id);
      continue;
    }
    const name = file.path || "encoded payload";
    const size = `${file.chars.toLocaleString("en-US")} characters, about ${tokens.toLocaleString("en-US")} tokens`;
    gaps.push(
      capped
        ? `Script not sent, the review request is at its size cap: ${name} (${size}, ${left.toLocaleString("en-US")} of ${budget_tokens.toLocaleString("en-US")} script tokens left after the rest of the request).`
        : `Script not sent, over the review budget: ${name} (${size}, ${left.toLocaleString("en-US")} of ${budget_tokens.toLocaleString("en-US")} tokens left).`,
    );
  }
  return { sent, gaps, over_budget, context, earlier, tokens: budget_tokens - left };
};

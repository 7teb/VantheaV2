import path from "node:path";
import type { McpTier } from "../../shared/approval.ts";
import { cap_bytes, head_tail_bytes, section_caps } from "./review-budget.ts";
import { review_headers } from "./review-prompt.ts";
import { file_block, section } from "./review-sections.ts";
import type { RetainedScript } from "./script-retention.ts";
import type { PinChange } from "./source-read.ts";
import type { ScriptFile } from "./sources.ts";
import { path_key } from "../storage/paths.ts";

export type ActionView = {
  tool: string;
  cwd: string;
  background: boolean;
  subject: string;
  mcp: { tier: McpTier; trusted: boolean } | null;
  files: ScriptFile[];
  gaps: string[];
  changed: PinChange[];
  edits: { text: string; since: number };
  facts: string[];
};

export type ScriptPlacement = { sent: ReadonlySet<string>; over_budget: ReadonlySet<string>; gaps: string[] };

const gap_chars = 4000;

const review_time = (at: number): string => new Date(at).toISOString().slice(5, 19).replace("T", " ");

const hash16 = (sha256: string | null) => (sha256 ?? "absent").slice(0, 16);

const change_note = (file: ScriptFile): string | null => {
  const mark = file.change;
  if (!mark) return null;
  if (mark.kind === "modified") return `modified since this chat started at ${review_time(mark.at)}`;
  return mark.same_bytes ? `written by ${mark.actor} via ${mark.tool} at ${review_time(mark.at)}` : `written by ${mark.actor} at ${review_time(mark.at)}, changed on disk since`;
};

const history_note = (file: ScriptFile, history: RetainedScript[]): string | null => {
  const same_path = history.filter((entry) => path_key(entry.path) === path_key(file.path));
  const same = same_path.filter((entry) => entry.sha256 === file.sha256).at(-1);
  if (same) return `reviewed before at ${review_time(same.at)}: ${same.verdict}`;
  const other = same_path.at(-1);
  return other ? `changed since the review at ${review_time(other.at)}` : null;
};

const during_note = (file: ScriptFile, changed: PinChange[]): string | null => {
  const change = changed.find((entry) => path_key(entry.path) === path_key(file.abs));
  return change ? `changed during the review of this call, before ${hash16(change.before)}` : null;
};

const file_label = (file: ScriptFile, history: RetainedScript[], changed: PinChange[]): string => {
  const notes = [
    `id ${file.id}`,
    file.role,
    `${file.chars} characters`,
    ...(file.sha256 ? [`sha256 ${hash16(file.sha256)}`] : []),
    change_note(file),
    file.path ? history_note(file, history) : null,
    during_note(file, changed),
  ].filter((note): note is string => Boolean(note));
  return `${file.path || "encoded payload"} (${notes.join(", ")})`;
};

const not_sent_reason = (file: ScriptFile, placement: ScriptPlacement): string => {
  if (file.binary) return "binary";
  if (file.over_limit) return "over the read limit";
  return placement.over_budget.has(file.id) ? "over the review budget" : "unchanged in this chat";
};

const pending_lines = (action: ActionView, tag: string): string[] => {
  const mcp = action.mcp;
  const kind = mcp ? "ARGUMENTS" : "COMMAND";
  return [
    `tool: ${action.tool}`,
    `working directory: ${action.cwd || "(unknown)"}`,
    `runs in background: ${action.background ? "yes" : "no"}`,
    ...(mcp ? [`risk tier: ${mcp.tier}, ${mcp.trusted ? "trusted" : "untrusted"} server`] : []),
    mcp ? "arguments:" : "command:",
    `----- BEGIN ${kind} [tag ${tag}] -----\n${action.subject}\n----- END ${kind} [tag ${tag}] -----`,
  ];
};

const gap_lines = (gaps: string[]): string[] => {
  const lines: string[] = [];
  let used = 0;
  for (const [index, gap] of gaps.entries()) {
    if (used + gap.length > gap_chars) {
      lines.push(`(${gaps.length - index} more gaps)`);
      break;
    }
    lines.push(gap);
    used += gap.length + 1;
  }
  return lines;
};

export type CurrentPart = { text: string; gaps: string[]; script_gaps: string[] };

export const current_part = (action: ActionView, placement: ScriptPlacement, history: RetainedScript[], tag: string): CurrentPart => {
  const sent = action.files.filter((file) => placement.sent.has(file.id));
  const listed = action.files.filter((file) => !placement.sent.has(file.id) && file.role !== "payload");
  const script_text = [
    ...sent.map((file) => file_block(file_label(file, history, action.changed), file.text ?? "", tag)),
    ...(listed.length ? ["not sent as text:"] : []),
    ...listed.map((file) =>
      JSON.stringify({ id: file.id, path: file.path, role: file.role, chars: file.chars, sha256: file.sha256 ? hash16(file.sha256) : null, why: not_sent_reason(file, placement) }),
    ),
  ];
  const missing = action.changed.filter((change) => change.after === null).map((change) => `Script changed during the review of this call and is now missing: ${path.basename(change.path)} (${change.path}).`);
  const edit_cap = cap_bytes(section_caps.agent_edits);
  const edits_text = head_tail_bytes(action.edits.text, edit_cap);
  const edit_gap = edits_text === action.edits.text ? [] : ["Agent edits to instruction files exceed the review cap; the middle of the diff is not shown."];
  const gaps = [...action.gaps, ...placement.gaps, ...missing, ...edit_gap];
  const edits = action.edits.text
    ? [`changes since human message #${action.edits.since}, made by the agent or its commands; not the human's rules`, edits_text]
    : [];
  const facts = head_tail_bytes(action.facts.join("\n"), cap_bytes(section_caps.target_facts));
  const text = [
    section(review_headers.pending_action, pending_lines(action, tag)),
    section(review_headers.scripts_run, script_text),
    section(review_headers.inspection_gaps, gap_lines(gaps)),
    section(review_headers.agent_edits, edits),
    section(review_headers.target_facts, facts ? [facts] : []),
  ].join("");
  return { text, gaps, script_gaps: [...placement.gaps, ...missing] };
};

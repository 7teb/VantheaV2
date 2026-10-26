import path from "node:path";
import type { McpTier } from "../../shared/approval.ts";
import { shell_labels } from "../../shared/shell.ts";
import { cap_bytes, head_tail_bytes, section_caps, trimmed, type TrimLevel } from "./review-budget.ts";
import { review_headers } from "./review-prompt.ts";
import { file_block, section } from "./review-sections.ts";
import type { RetainedScript } from "./script-retention.ts";
import type { PinChange } from "./source-read.ts";
import type { ScriptFile } from "./sources.ts";
import type { Dialect } from "./statements.ts";
import type { ChangeMark } from "./written-files.ts";
import { path_key } from "../storage/paths.ts";

export type ActionCall = { kind: "command" } | { kind: "mcp"; tier: McpTier; trusted: boolean } | { kind: "tool" };

export type ActionView = {
  tool: string;
  cwd: string;
  background: boolean;
  subject: string;
  call: ActionCall;
  files: ScriptFile[];
  gaps: string[];
  changed: PinChange[];
  edits: { text: string; since: number };
  facts: string[];
  shell?: Dialect;
};

export type ScriptPlacement = { sent: ReadonlySet<string>; over_budget: ReadonlySet<string>; context: ReadonlySet<string>; earlier: ReadonlyMap<string, RetainedScript>; gaps: string[] };

const gap_chars = 4000;

const shell_lines: Partial<Record<Dialect, string>> = { powershell: `shell: ${shell_labels.powershell}`, posix: `shell: ${shell_labels.bash} (bash -c)` };

const review_time = (at: number): string => new Date(at).toISOString().slice(5, 19).replace("T", " ");

const hash16 = (sha256: string | null) => (sha256 ?? "absent").slice(0, 16);

export const change_text = (mark: ChangeMark): string => {
  if (mark.kind === "created") return `created in this chat at ${review_time(mark.at)}`;
  if (mark.kind === "modified") return `modified since this chat started at ${review_time(mark.at)}`;
  const older = mark.before_chat ? ", existed before this chat" : "";
  return mark.same_bytes ? `written by ${mark.actor} via ${mark.tool} at ${review_time(mark.at)}${older}` : `written by ${mark.actor} at ${review_time(mark.at)}, changed on disk since${older}`;
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
    file.change ? change_text(file.change) : null,
    file.path ? history_note(file, history) : null,
    during_note(file, changed),
  ].filter((note): note is string => Boolean(note));
  return `${file.path || "encoded payload"} (${notes.join(", ")})`;
};

const not_sent_reason = (file: ScriptFile, placement: ScriptPlacement): string => {
  if (file.binary) return "binary";
  if (file.over_limit) return "over the read limit";
  if (!placement.over_budget.has(file.id)) return "unchanged in this chat";
  const earlier = placement.earlier.get(file.id);
  if (earlier) return `over the review budget, sent in the review at ${review_time(earlier.at)} with this hash: ${earlier.verdict}`;
  if (!placement.context.has(file.id)) return "over the review budget";
  return file.change ? `over the review budget, ${change_text(file.change)}` : "over the review budget, unchanged in this chat";
};

const pending_lines = (action: ActionView, tag: string): string[] => {
  const { call } = action;
  const kind = call.kind === "command" ? "COMMAND" : "ARGUMENTS";
  const shell = call.kind === "command" && action.shell ? shell_lines[action.shell] : undefined;
  return [
    `tool: ${action.tool}`,
    `working directory: ${action.cwd || "(unknown)"}`,
    `runs in background: ${action.background ? "yes" : "no"}`,
    ...(shell ? [shell] : []),
    ...(call.kind === "mcp" ? [`risk tier: ${call.tier}, ${call.trusted ? "trusted" : "untrusted"} server`] : []),
    call.kind === "command" ? "command:" : "arguments:",
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

export type CurrentPart = { text: string; gaps: string[] };

export const current_part = (action: ActionView, placement: ScriptPlacement, history: RetainedScript[], tag: string, level: TrimLevel = 0): CurrentPart => {
  const capped = trimmed(level, "scripts_run");
  const sent = action.files.filter((file) => placement.sent.has(file.id));
  const listed = action.files.filter((file) => !placement.sent.has(file.id) && file.role !== "payload");
  const script_text = [
    ...sent.map((file) => file_block(file_label(file, history, action.changed), file.text ?? "", tag)),
    ...(listed.length ? ["not sent as text:"] : []),
    ...listed.map((file) => {
      const summary = placement.earlier.get(file.id)?.summary;
      return JSON.stringify({ id: file.id, path: file.path, role: file.role, chars: file.chars, sha256: file.sha256 ? hash16(file.sha256) : null, why: not_sent_reason(file, placement), ...(summary ? { summary } : {}) });
    }),
  ];
  const missing = action.changed.filter((change) => change.after === null).map((change) => `Script changed during the review of this call and is now missing: ${path.basename(change.path)} (${change.path}).`);
  const edits_text = capped ? head_tail_bytes(action.edits.text, cap_bytes(section_caps.agent_edits)) : action.edits.text;
  const edit_gap = edits_text === action.edits.text ? [] : ["Agent edits to instruction files exceed the review cap; the middle of the diff is not shown."];
  const gaps = [...action.gaps, ...placement.gaps, ...missing, ...edit_gap];
  const edits = action.edits.text
    ? [`changes since human message #${action.edits.since}, made by the agent or its commands; not the human's rules`, edits_text]
    : [];
  const all_facts = action.facts.join("\n");
  const facts = capped ? head_tail_bytes(all_facts, cap_bytes(section_caps.target_facts)) : all_facts;
  const text = [
    section(review_headers.pending_action, pending_lines(action, tag)),
    section(review_headers.scripts_run, script_text),
    section(review_headers.inspection_gaps, gap_lines(gaps)),
    section(review_headers.agent_edits, edits),
    section(review_headers.target_facts, facts ? [facts] : []),
  ].join("");
  return { text, gaps };
};

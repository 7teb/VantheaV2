import { workflow_counts, workflow_seconds, type WorkflowStatus, type WorkflowSummary } from "./workflow.ts";

export const workflow_event_marker = "[WORKFLOW RESULT EVENT]";

export const inline_result_chars = 40_000;

export type WorkflowNoticeInput = {
  summary: WorkflowSummary;
  value_json: string | null;
  result_path: string | null;
  stopped_by: string;
};

const count_line = (summary: WorkflowSummary): string => {
  const counts = workflow_counts(summary.agents);
  const parts = [
    `${counts.completed} completed`,
    ...(counts.cached ? [`${counts.cached} cached`] : []),
    ...(counts.skipped ? [`${counts.skipped} skipped`] : []),
    ...(counts.failed ? [`${counts.failed} failed`] : []),
    ...(counts.stopped ? [`${counts.stopped} stopped`] : []),
  ];
  return `Agents: ${summary.agents.length} (${parts.join(", ")}).`;
};

const value_lines = (value_json: string, result_path: string | null): string[] => {
  if (value_json.length <= inline_result_chars) {
    return [`Return value (JSON${result_path ? `, also saved in ${result_path}` : ""}):`, value_json];
  }
  return [
    `Return value (JSON, ${value_json.length} characters; the first ${inline_result_chars} follow, read the complete value from ${result_path ?? "the result file"} before relying on the rest):`,
    value_json.slice(0, inline_result_chars),
  ];
};

const failure_lines = (summary: WorkflowSummary): string[] => {
  const groups = new Map<string, string[]>();
  for (const agent of summary.agents) {
    if (agent.status === "failed" || agent.status === "interrupted") {
      const reason = agent.error || "no error recorded";
      groups.set(reason, [...(groups.get(reason) ?? []), agent.label]);
    }
  }
  return groups.size ? ["Failed agents (their agent() calls returned null or threw):", ...[...groups].map(([reason, labels]) => `- ${labels.join(", ")}: ${reason}`)] : [];
};

const status_lines: Record<WorkflowStatus, (input: WorkflowNoticeInput) => string[]> = {
  running: () => [],
  completed: ({ value_json, result_path }) => value_lines(value_json ?? "null", result_path),
  failed: ({ summary }) => [`Error: ${summary.error || "unknown error"}`],
  stopped: ({ summary, stopped_by }) => [`It was stopped by ${stopped_by}. ${summary.error}`.trim()],
  interrupted: ({ summary }) => [summary.error || "The app closed while it was running."],
};

const escaped_marker = String.raw`\u005bWORKFLOW RESULT EVENT]`;

const defuse = (line: string): string => line.split(workflow_event_marker).join(escaped_marker);

const one_line = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, " ");

export const workflow_notice_text = (input: WorkflowNoticeInput): string => {
  const { summary } = input;
  const resumable = summary.status !== "completed" ? [`Resume it with run_workflow and resume_from ${summary.run_id}: finished agents return their journaled results at once, the rest runs live.`] : [];
  const body = [
    `Workflow ${one_line(summary.name)} (run ${summary.run_id}) ended with status ${summary.status} after ${workflow_seconds(summary)}s.`,
    count_line(summary),
    ...failure_lines(summary),
    `Script: ${summary.script_path}`,
    ...status_lines[summary.status](input),
    ...resumable,
  ];
  return [workflow_event_marker, ...body.map(defuse)].join("\n");
};

export type WorkflowNote = { run_id: string; name: string; status: string };

const head_line = /^Workflow (.+) \(run (wf_[A-Za-z0-9-]+)\) ended with status (\w+) after \d+s\.$/;

export const parse_workflow_notice = (text: string): WorkflowNote | null => {
  const [marker, head = ""] = text.split("\n", 2);
  if (marker !== workflow_event_marker) {
    return null;
  }
  const match = head_line.exec(head);
  return match ? { name: match[1] ?? "", run_id: match[2] ?? "", status: match[3] ?? "" } : null;
};

export const split_workflow_notices = (text: string): string[] =>
  text
    .split(workflow_event_marker)
    .slice(1)
    .map((part) => `${workflow_event_marker}${part}`.trimEnd())
    .filter((part) => parse_workflow_notice(part) !== null);

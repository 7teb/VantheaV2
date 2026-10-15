import fs from "node:fs/promises";
import { report_file_notice } from "../../shared/agent-notes.ts";
import type { Step } from "../../shared/chat.ts";
import { agent_label, type PeerMessage } from "../../shared/peer-notes.ts";
import type { PeerOutcome } from "../../shared/tool-view.ts";
import { estimate_tokens, result_cap_tokens, token_prefix } from "../context/estimate.ts";
import type { ToolProfile } from "../tools/types.ts";
import { last_text, read_agent_run } from "./live.ts";
import { received_messages, sent_messages, view_paths, type PeerView } from "./peer-steps.ts";
import { questions_asked_by, questions_asked_to } from "./questions.ts";
import type { AgentRecord, RunRecord } from "./records.ts";
import { ensure_report_file } from "./report-file.ts";
import { label_of, profile_text, question_line } from "./roster.ts";
import { get_agent } from "./store.ts";

const activity_chars = 500;

const continuation_tokens = 200;

const outcome_text: Record<PeerOutcome, string> = {
  queued: "delivered to the recipient's inbox",
  held: "kept for the recipient's next run",
  denied: "denied by the review, not delivered",
  declined: "declined by the user, not delivered",
  not_running: "not sent, the recipient was not running",
  duplicate: "not sent again, identical to an earlier message",
};

export const elapsed_seconds = (run: RunRecord): number => {
  const started = Date.parse(run.started_at);
  const ended = run.ended_at ? Date.parse(run.ended_at) : Date.now();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};

const list = (label: string, entries: string[]) => (entries.length ? [`${label} (${entries.length}):`, ...entries.map((entry) => `- ${entry}`)] : [`${label}: none.`]);

const received_line = (message: PeerMessage): string =>
  `[${message.message_id}] from ${agent_label(message.sender_name, message.sender_id)}, ${message.type}${message.in_reply_to ? ` to ${message.in_reply_to}` : ""}, about ${message.about}\nsummary: ${message.summary}\ntext:\n${message.text}`;

const sent_outcome = (view: PeerView): string => {
  const kept = view.outcome === "queued" && get_agent(view.to_id)?.held.some((entry) => entry.from === "peer" && entry.message_id === view.message_id);
  return kept ? "kept for the recipient's next run, it ended before reading it" : outcome_text[view.outcome];
};

const message_lines = (steps: Step[]): string[] => {
  const sent = sent_messages(steps).map(
    ({ view, text }) => `[${view.message_id || "not sent"}] to ${agent_label(view.to_name, view.to_id)}, ${view.type}, about ${view.about}, ${sent_outcome(view)}\nsummary: ${view.summary}\ntext:\n${text}`,
  );
  return [...list("Peer messages sent in this run", sent), ...list("Peer messages received in this run", received_messages(steps).map(received_line))];
};

const held_lines = (agent: AgentRecord): string[] =>
  list(
    "Messages kept for its next run, continue_agent delivers them",
    agent.held.map((entry) => (entry.from === "main" ? `instruction from the main agent, unread when the app closed:\n${entry.text}` : received_line(entry))),
  );

const question_lines = (agent: AgentRecord): string[] => {
  const asked = questions_asked_by(agent.agent_id).map(question_line);
  const incoming = questions_asked_to(agent.agent_id).map((question) => `from ${agent_label(question.asker_name, question.asker_id)} about ${question.about} (${question.message_id})`);
  return [...list("Open questions it asked", asked), ...list("Open questions asked to it", incoming)];
};

const running_lines = (steps: Step[]): string[] => {
  const tools = steps.flatMap((step) => (step.kind === "tool" && step.name ? [step.name] : []));
  const latest = last_text({ steps }).slice(-activity_chars);
  return [
    `Tool calls so far: ${tools.length}.${tools.length ? ` Most recent: ${tools.slice(-8).join(", ")}.` : ""}`,
    latest ? `Latest output: ${latest}` : "No text output yet.",
    "It is still working; its report arrives automatically when it finishes.",
  ];
};

const report_page = async (agent: AgentRecord, run: RunRecord, from: number, used: string): Promise<string> => {
  const report = await fs.readFile(await ensure_report_file(agent, run), "utf8");
  if (!report.trim()) {
    return "Report: (empty report)";
  }
  if (from >= report.length) {
    return `report_from ${from} is at or past the end of the report, which has ${report.length} characters.`;
  }
  const budget = Math.max(continuation_tokens, result_cap_tokens - estimate_tokens(used) - continuation_tokens);
  const page = token_prefix(report.slice(from), budget);
  const next = from + page.length;
  const rest =
    next < report.length
      ? `\n\n[The report continues for ${report.length - next} more characters. Call get_agent_status with agent_id ${agent.agent_id} and report_from ${next} for the rest.]`
      : "";
  return `Report${from ? ` from character ${from}` : ""}:\n${page}${rest}`;
};

const fit = (sections: string, room: number): string => {
  if (estimate_tokens(sections) <= room) {
    return sections;
  }
  const kept = token_prefix(sections, room - continuation_tokens);
  return `${kept}\n[The run detail is cut here: ${sections.length - kept.length} more characters do not fit the ${result_cap_tokens}-token tool result cap.]`;
};

const with_tail = (head: string, sections: string, tail: string): string =>
  [head, fit(sections, result_cap_tokens - estimate_tokens(head) - estimate_tokens(tail) - 2), tail].join("\n");

export const agent_detail = async (agent: AgentRecord, run: RunRecord, caller: ToolProfile, report_from = 0): Promise<string> => {
  const head = `Agent ${label_of(agent)} (${agent.agent_id}, "${agent.name}"), ${profile_text(agent)}, model ${agent.model}. Run ${run.run_id}: ${run.status} after ${elapsed_seconds(run)}s.`;
  if (report_from > 0 && run.status !== "running" && caller !== "main") {
    return `${head}\n${await report_page(agent, run, report_from, head)}`;
  }
  const { steps } = await read_agent_run(agent, run);
  const sections = [
    `Topic: ${agent.topic || "none"}. Scope: ${agent.scope.join(", ") || "none"}.`,
    `Task of this run:\n${run.prompt}`,
    ...list("Files read in this run", view_paths(steps, "read")),
    ...list("Files written in this run", view_paths(steps, "edit")),
    ...message_lines(steps),
    ...question_lines(agent),
    ...held_lines(agent),
  ].join("\n");
  if (run.status === "running") {
    return with_tail(head, sections, running_lines(steps).join("\n"));
  }
  if (caller === "main") {
    return with_tail(head, sections, report_file_notice(agent.agent_id, run.run_id, await ensure_report_file(agent, run)));
  }
  const body = `${head}\n${fit(sections, result_cap_tokens - estimate_tokens(head) - 2 * continuation_tokens)}`;
  return `${body}\n${await report_page(agent, run, report_from, body)}`;
};

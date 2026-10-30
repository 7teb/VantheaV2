import { randomUUID } from "node:crypto";
import type { Step } from "../../shared/chat.ts";
import { agent_label } from "../../shared/peer-notes.ts";
import type { PeerOutcome, ToolView } from "../../shared/tool-view.ts";
import { same_subject } from "../permissions/decisions.ts";
import type { PeerRequest, ToolResult } from "../tools/types.ts";
import type { InboxEntry, PeerEntry } from "./inbox.ts";
import { live_run, reachable_live, unreachable_state, type LiveRun } from "./live.ts";
import { received_message, sent_message, sent_messages, type SentMessage } from "./peer-steps.ts";
import { answer_question, ask_question, close_question, close_questions_to, forget_chat_questions } from "./questions.ts";
import { current_run, type AgentRecord, type RunRecord } from "./records.ts";
import { deliver_alert, queue_digest } from "./reports.ts";
import { label_of } from "./roster.ts";
import { find_agent, get_agent, hold_message } from "./store.ts";

export type PeerSender = { agent: AgentRecord; run: RunRecord; live: LiveRun };

const streaks = new Map<string, number>();

const delivered: readonly PeerOutcome[] = ["queued", "held"];

const pair_key = (chat_id: string, a: string, b: string) => `${chat_id}|${[a, b].sort().join("|")}`;

export const deliver_to = (live: LiveRun, entry: InboxEntry): void => {
  live.inbox.push(entry);
};

const new_message_id = () => `msg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

const message_line = (from: string, to: string, request: Pick<PeerRequest, "type" | "about" | "summary">) => `${from} → ${to}: ${request.type}, about ${request.about}: '${request.summary}'`;

const touches_peer = (step: Step, peer_id: string): boolean => {
  const sent = sent_message(step);
  if (sent) {
    return sent.view.to_id === peer_id && delivered.includes(sent.view.outcome);
  }
  return received_message(step)?.sender_id === peer_id;
};

const counts_as_work = (step: Step) => step.kind === "tool" && step.name !== "message_peer" && (step.status === "done" || step.status === "failed");

const is_empty = (steps: Step[], peer_id: string): boolean => {
  const anchor = steps.findLastIndex((step) => touches_peer(step, peer_id));
  return anchor >= 0 && !steps.slice(anchor + 1).some(counts_as_work);
};

const queued_text = (to: string, message_id: string, request: PeerRequest): string => {
  const head = `In the inbox of ${to} as ${message_id}; it arrives at its next round boundary.`;
  if (request.type !== "question") {
    return `${head} Keep working.`;
  }
  return `${head} The question does not block you: keep working. The answer arrives at your next round boundary; if you finish first, it is kept for your next run and the main agent is told. Do not stop or idle to wait for it.`;
};

const not_running_text = (target: AgentRecord, to: string, type: PeerRequest["type"]) =>
  `${to} ${unreachable_state(target)}, so this ${type} was not sent; only an answer reaches an agent that has finished. get_agent_status with agent_id ${target.agent_id} gives its report. Only the main agent can continue it, with continue_agent.`;

const same_message = (sent: SentMessage, request: PeerRequest): boolean =>
  sent.view.type === request.type && sent.in_reply_to === request.in_reply_to && same_subject(sent.view.about, request.about) && same_subject(sent.text, request.text);

const loop_text = (other: string) =>
  `You and ${other} are messaging each other without working in between. Continue with your task; an open disagreement belongs in your report.`;

const track_exchange = (sender: PeerSender, target: AgentRecord, target_live: LiveRun, empty: boolean, line: string) => {
  const key = pair_key(sender.agent.chat_id, sender.agent.agent_id, target.agent_id);
  if (!empty) {
    streaks.delete(key);
    return;
  }
  const streak = (streaks.get(key) ?? 0) + 1;
  if (streak < 2) {
    streaks.set(key, streak);
    return;
  }
  streaks.delete(key);
  const [from, to] = [label_of(sender.agent), label_of(target)];
  deliver_to(sender.live, { from: "app", text: loop_text(to) });
  deliver_to(target_live, { from: "app", text: loop_text(from) });
  deliver_alert({
    chat_id: sender.agent.chat_id,
    agent_id: sender.agent.agent_id,
    run_id: sender.run.run_id,
    name: sender.agent.name,
    cause: "loop",
    body: `${from} and ${to} sent each other two messages in a row without any other tool call in between. Latest: ${line}. Both were told to continue their tasks. Steer them with message_agent or stop one with cancel_agent if they are stuck.`,
  });
};

const hold_answer = (target: AgentRecord, entry: PeerEntry, line: string) => {
  hold_message(target.agent_id, entry);
  queue_digest(target.chat_id, `${line}. ${label_of(target)} has finished, so the answer ${entry.message_id} is kept for its next run; continue_agent with agent_id ${target.agent_id} delivers it.`);
};

export const send_peer = async (sender: PeerSender, request: PeerRequest): Promise<ToolResult> => {
  const found = find_agent(request.to, sender.agent.chat_id);
  if (!found.agent) {
    const main = /^main(\s|$)/i.test(request.to.trim());
    return { status: "failed", text: main ? "The main agent is not a peer; reach it with message_main_agent." : found.error, view: null };
  }
  const target = found.agent;
  if (target.agent_id === sender.agent.agent_id) {
    return { status: "failed", text: "That is your own id; message_peer sends to another agent of this chat.", view: null };
  }
  const [from, to] = [label_of(sender.agent), label_of(target)];
  const view = (message_id: string, outcome: PeerOutcome): ToolView => ({
    kind: "peer_message",
    message_id,
    to_name: target.name,
    to_id: target.agent_id,
    type: request.type,
    about: request.about,
    summary: request.summary,
    outcome,
  });
  const answer = request.type === "answer";
  const live = reachable_live(target);
  if (!answer && !live) {
    return { status: "failed", text: not_running_text(target, to, request.type), view: view("", "not_running") };
  }
  const steps = sender.live.transcript.steps;
  const duplicate = sent_messages(steps).find(
    (sent) => sent.view.to_id === target.agent_id && delivered.includes(sent.view.outcome) && !sender.live.resendable.has(sent.view.message_id) && same_message(sent, request),
  );
  if (duplicate) {
    const text = `Not sent again: the text is identical to ${duplicate.view.message_id}, which already reached ${to}. Keep working.`;
    return { status: "done", text, view: view(duplicate.view.message_id, "duplicate") };
  }
  const empty = is_empty(steps, target.agent_id);
  const message_id = new_message_id();
  const line = message_line(from, to, request);
  const entry: PeerEntry = {
    from: "peer",
    message_id,
    sender_id: sender.agent.agent_id,
    sender_name: sender.agent.name,
    type: request.type,
    about: request.about,
    summary: request.summary,
    text: request.text,
    in_reply_to: answer ? request.in_reply_to : null,
    sent_at: Date.now(),
  };
  const answered = answer && request.in_reply_to ? answer_question(request.in_reply_to, target.agent_id, sender.agent.agent_id) : null;
  if (!live) {
    hold_answer(target, entry, line);
    const text = `${to} has finished. Your answer ${message_id} is kept and reaches it when the main agent continues it; the main agent was told. Keep working.`;
    return { status: "done", text, view: view(message_id, "held") };
  }
  deliver_to(live, entry);
  if (request.type === "question") {
    ask_question({
      message_id,
      chat_id: sender.agent.chat_id,
      asker_id: sender.agent.agent_id,
      asker_name: sender.agent.name,
      to_id: target.agent_id,
      to_name: target.name,
      about: request.about,
      summary: request.summary,
      at: Date.now(),
    });
  }
  queue_digest(sender.agent.chat_id, line);
  if (!answered) {
    track_exchange(sender, target, live, empty, line);
  }
  return { status: "done", text: queued_text(to, message_id, request), view: view(message_id, "queued") };
};

const unread_ids = (agent: AgentRecord): Set<string> => {
  const run = current_run(agent);
  const live = run ? live_run(run.run_id) : null;
  return new Set((live?.inbox ?? []).flatMap((entry) => (entry.from === "peer" ? [entry.message_id] : [])));
};

export const on_peer_ended = (agent: AgentRecord): void => {
  const name = label_of(agent);
  for (const question of close_questions_to(agent.agent_id, unread_ids(agent))) {
    const asker = get_agent(question.asker_id);
    const live = asker ? reachable_live(asker) : null;
    if (live) {
      live.resendable.add(question.message_id);
      deliver_to(live, { from: "app", text: `${name} ended without an answer to your question ${question.message_id} about ${question.about}; get_agent_status with agent_id ${agent.agent_id} gives its report.` });
      continue;
    }
    queue_digest(question.chat_id, `${name} ended without answering the question ${question.message_id} of ${agent_label(question.asker_name, question.asker_id)} about ${question.about}; the asker has finished too.`);
  }
};

const last_round = (live: LiveRun) => live.transcript.steps.at(-1)?.round ?? 0;

const tell_sender = (sender_live: LiveRun, text: string, closing: boolean) => {
  if (closing) {
    sender_live.emit({ type: "notice", round: last_round(sender_live), notice: "peer_status", text });
    return;
  }
  deliver_to(sender_live, { from: "app", text });
};

export const return_undelivered = (live: LiveRun, closing = false): void => {
  const entries = live.inbox;
  live.inbox = [];
  const agent = get_agent(live.agent_id);
  if (live.removed || !agent) {
    return;
  }
  const name = label_of(agent);
  for (const entry of entries) {
    if (entry.from === "app") {
      continue;
    }
    if (entry.from === "main" && closing) {
      hold_message(agent.agent_id, entry);
      continue;
    }
    if (entry.from === "main") {
      queue_digest(live.chat_id, `${name} ended before it read your message_agent instruction: ${entry.text}`);
      continue;
    }
    const line = message_line(agent_label(entry.sender_name, entry.sender_id), name, entry);
    if (entry.type === "answer") {
      hold_answer(agent, entry, line);
      continue;
    }
    close_question(entry.message_id);
    const sender = get_agent(entry.sender_id);
    const sender_live = sender ? reachable_live(sender) : null;
    if (sender_live) {
      sender_live.resendable.add(entry.message_id);
      tell_sender(sender_live, `${name} ended before it read your message ${entry.message_id} (${entry.type}, about ${entry.about}).`, closing);
      continue;
    }
    queue_digest(live.chat_id, `${name} ended before it read the message ${entry.message_id} (${line}); the sender has finished too.`);
  }
};

export const forget_chat_peers = (chat_id: string): void => {
  forget_chat_questions(chat_id);
  for (const key of [...streaks.keys()]) {
    if (key.startsWith(`${chat_id}|`)) {
      streaks.delete(key);
    }
  }
};

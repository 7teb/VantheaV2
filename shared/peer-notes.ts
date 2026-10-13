import type { AgentNote } from "./agent-notes.ts";

export type PeerType = "info" | "question" | "answer";

export const peer_types: readonly PeerType[] = ["info", "question", "answer"];

export type PeerMessage = {
  message_id: string;
  sender_id: string;
  sender_name: string;
  type: PeerType;
  about: string;
  summary: string;
  text: string;
  in_reply_to: string | null;
};

export type PeerAlertCause = "blocked" | "loop";

export type PeerAlert = { cause: PeerAlertCause; name: string; agent_id: string; body: string };

const message_head = /^Peer message (\S+) from (.*) \(([^()\s]+)\)$/;

const text_label = "\n\nTEXT:\n";

const alert_marker = "[PEER ALERT]";

const alert_end = "[END PEER ALERT]";

const alert_head = /^ (blocked|loop): (.*) \(([^()\s]+)\)$/;

export const short_agent_id = (agent_id: string): string => agent_id.replace(/^agent_/, "").replace(/[^0-9a-f]/gi, "").slice(0, 8);

export const agent_label = (name: string, agent_id: string): string => `${name}#${short_agent_id(agent_id)}`;

const field_of = (head: string, label: string) => new RegExp(`^${label}: (.*)$`, "m").exec(head)?.[1]?.trim() ?? "";

export const peer_notice_text = (message: PeerMessage): string =>
  [
    `Peer message ${message.message_id} from ${message.sender_name} (${message.sender_id})`,
    `type: ${message.type}`,
    `about: ${message.about}`,
    `summary: ${message.summary}`,
    ...(message.in_reply_to ? [`in_reply_to: ${message.in_reply_to}`] : []),
  ].join("\n") + `${text_label}${message.text}`;

export const parse_peer_notice = (text: string): PeerMessage | null => {
  const split = text.indexOf(text_label);
  const head = split < 0 ? text : text.slice(0, split);
  const first = message_head.exec(head.split("\n")[0] ?? "");
  const type = field_of(head, "type");
  if (!first || !peer_types.includes(type as PeerType)) {
    return null;
  }
  return {
    message_id: first[1] ?? "",
    sender_name: first[2] ?? "",
    sender_id: first[3] ?? "",
    type: type as PeerType,
    about: field_of(head, "about"),
    summary: field_of(head, "summary"),
    text: split < 0 ? "" : text.slice(split + text_label.length),
    in_reply_to: field_of(head, "in_reply_to") || null,
  };
};

export const peer_alert_intro =
  "[Internal app event, not a user message. Messages between your sub-agents need your attention: the review blocked one, or two agents kept messaging each other without working in between. Read it and decide whether to steer an agent with message_agent, stop one with cancel_agent, or let them continue. A message the review blocked was not delivered.]";

const wrapped_marker = `${peer_alert_intro}\n\n${alert_marker}`;

export const peer_alert_text = (alert: PeerAlert): string => `${alert_marker} ${alert.cause}: ${alert.name} (${alert.agent_id})\n\n${alert.body}\n${alert_end}`;

const alert_note = (chunk: string): AgentNote | null => {
  const split = chunk.indexOf("\n\n");
  const head = alert_head.exec(split < 0 ? chunk : chunk.slice(0, split));
  if (!head) {
    return null;
  }
  const body = split < 0 ? "" : chunk.slice(split + 2);
  return { kind: "alert", status: head[1] ?? "", name: head[2] ?? "", agent_id: head[3] ?? "", seconds: null, body: body.trim() };
};

const next_alert = (text: string, from: number): number => {
  const at = text.indexOf(wrapped_marker, from);
  return at < 0 ? -1 : at + wrapped_marker.length - alert_marker.length;
};

export const parse_peer_alerts = (text: string): AgentNote[] => {
  const notes: AgentNote[] = [];
  let start = text.startsWith(alert_marker) ? 0 : next_alert(text, 0);
  while (start >= 0) {
    const from = start + alert_marker.length;
    const end = text.indexOf(alert_end, from);
    const note = alert_note(text.slice(from, end < 0 ? text.length : end));
    if (note) {
      notes.push(note);
    }
    start = end < 0 ? -1 : next_alert(text, end);
  }
  return notes;
};

import { peer_types, type PeerMessage } from "../../shared/peer-notes.ts";
import { as_record, as_string } from "../storage/coerce.ts";

export type MainEntry = { from: "main"; text: string };

export type PeerEntry = { from: "peer"; sent_at?: number } & PeerMessage;

export type StatusEntry = { from: "app"; text: string };

export type InboxEntry = MainEntry | PeerEntry | StatusEntry;

export type HeldEntry = MainEntry | PeerEntry;

const parse_peer = (raw: Record<string, unknown>): PeerEntry | null => {
  const message_id = as_string(raw.message_id);
  const type = peer_types.find((entry) => entry === raw.type);
  if (!message_id || !type) {
    return null;
  }
  return {
    from: "peer",
    message_id,
    sender_id: as_string(raw.sender_id),
    sender_name: as_string(raw.sender_name, "Agent"),
    type,
    about: as_string(raw.about),
    summary: as_string(raw.summary),
    text: as_string(raw.text),
    in_reply_to: as_string(raw.in_reply_to) || null,
    ...(typeof raw.sent_at === "number" && Number.isFinite(raw.sent_at) ? { sent_at: raw.sent_at } : {}),
  };
};

export const parse_held = (value: unknown): HeldEntry | null => {
  const raw = as_record(value);
  if (raw.from === "main") {
    const text = as_string(raw.text);
    return text ? { from: "main", text } : null;
  }
  return raw.from === "peer" ? parse_peer(raw) : null;
};

import type { Step, ToolStep } from "../../shared/chat.ts";
import { parse_peer_notice, type PeerMessage } from "../../shared/peer-notes.ts";
import type { ToolView } from "../../shared/tool-view.ts";

export type PeerView = Extract<ToolView, { kind: "peer_message" }>;

export type SentMessage = { step: ToolStep; view: PeerView; text: string; in_reply_to: string | null };

const arg_text = (step: ToolStep, key: string): string => {
  const value = step.args[key];
  return typeof value === "string" ? value : "";
};

export const sent_message = (step: Step): SentMessage | null => {
  if (step.kind !== "tool" || step.view?.kind !== "peer_message") {
    return null;
  }
  return { step, view: step.view, text: arg_text(step, "text"), in_reply_to: arg_text(step, "in_reply_to").trim() || null };
};

export const sent_messages = (steps: Step[]): SentMessage[] =>
  steps.flatMap((step) => {
    const sent = sent_message(step);
    return sent ? [sent] : [];
  });

export const received_message = (step: Step): PeerMessage | null => (step.kind === "notice" && step.notice === "peer_message" ? parse_peer_notice(step.text) : null);

export const received_messages = (steps: Step[]): PeerMessage[] =>
  steps.flatMap((step) => {
    const received = received_message(step);
    return received ? [received] : [];
  });

export const view_paths = (steps: Step[], kind: "edit" | "read"): string[] => {
  const paths = steps.flatMap((step) => (step.kind === "tool" && step.status === "done" && step.view?.kind === kind ? [step.view.path] : []));
  return [...new Set(paths)];
};

import { own_send, type AssistantMessage, type CompactionStep, type Message, type NoticeKind, type NoticeStep, type ReasoningStep, type SteerStep, type Step, type TextStep, type ToolStep } from "../../../shared/chat.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { is_active_status, is_hidden_step } from "../tools/tool-meta.ts";

export type Block =
  | { kind: "reasoning"; id: string; step: ReasoningStep }
  | { kind: "text"; id: string; step: TextStep }
  | { kind: "tools"; id: string; steps: ToolStep[] }
  | { kind: "plan"; id: string; step: ToolStep; text: string }
  | { kind: "image"; id: string; step: ToolStep; view: Extract<ToolView, { kind: "image" }> }
  | { kind: "visual"; id: string; step: ToolStep; view: Extract<ToolView, { kind: "visual" }> }
  | { kind: "steer"; id: string; step: SteerStep }
  | { kind: "notice"; id: string; step: NoticeStep }
  | { kind: "compaction"; id: string; step: CompactionStep };

const hidden_notices: ReadonlySet<NoticeKind> = new Set(["peer_digest", "agent_roster", "todos_carried", "update_reminder"]);

const plain_block = (step: Exclude<Step, ToolStep>): Block | null => {
  switch (step.kind) {
    case "reasoning":
      return { kind: "reasoning", id: step.id, step };
    case "text":
      return step.text ? { kind: "text", id: step.id, step } : null;
    case "steer":
      return { kind: "steer", id: step.id, step };
    case "notice":
      return hidden_notices.has(step.notice) ? null : { kind: "notice", id: step.id, step };
    case "compaction":
      return { kind: "compaction", id: step.id, step };
  }
};

export const build_blocks = (steps: Step[]): Block[] => {
  const blocks: Block[] = [];
  for (const step of steps) {
    if (step.kind !== "tool") {
      const block = plain_block(step);
      if (block) {
        blocks.push(block);
      }
      continue;
    }
    if (is_hidden_step(step)) {
      continue;
    }
    if (step.view?.kind === "plan") {
      blocks.push({ kind: "plan", id: step.id, step, text: step.view.text });
      continue;
    }
    if (step.view?.kind === "image" && step.view.images.length > 0) {
      blocks.push({ kind: "image", id: step.id, step, view: step.view });
      continue;
    }
    if (step.status === "done" && step.view?.kind === "visual") {
      blocks.push({ kind: "visual", id: step.id, step, view: step.view });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === "tools") {
      blocks[blocks.length - 1] = { ...last, steps: [...last.steps, step] };
      continue;
    }
    blocks.push({ kind: "tools", id: step.id, steps: [step] });
  }
  return blocks;
};

export const is_live_block = (block: Block | undefined): boolean => {
  switch (block?.kind) {
    case "reasoning":
      return block.step.ended_at === null;
    case "text":
      return true;
    case "tools":
      return block.steps.some((step) => is_active_status(step.status));
    case "compaction":
      return block.step.status === "running" || block.step.status === "waiting";
    default:
      return false;
  }
};

export const shows_thinking = (streaming: boolean, retrying: boolean, blocks: Block[]): boolean => streaming && !retrying && !is_live_block(blocks.at(-1));

export const answer_text = (message: AssistantMessage) =>
  message.steps
    .flatMap((step) => (step.kind === "text" && step.text.trim() ? [step.text.trim()] : []))
    .join("\n\n");

const has_plan = (message: Message) =>
  message.role === "assistant" && message.steps.some((step) => step.kind === "tool" && step.view?.kind === "plan");

type PlanState = { last_plan_id: string | null; accepted: Set<string> };

export const plan_state = (messages: Message[]): PlanState => {
  const accepted = new Set<string>();
  let last_plan_id: string | null = null;
  let pending: string | null = null;
  for (const message of messages) {
    if (has_plan(message)) {
      last_plan_id = message.id;
      pending = message.id;
      continue;
    }
    if (message.role === "user" && message.origin === "plan_accept" && pending) {
      accepted.add(pending);
      pending = null;
    }
  }
  return { last_plan_id, accepted };
};

export const last_own_send = (messages: Message[]): string => messages.findLast(own_send)?.id ?? "";

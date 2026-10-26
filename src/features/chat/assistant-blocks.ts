import { own_send, type AssistantMessage, type CompactionStep, type Message, type NoticeKind, type NoticeStep, type ReasoningStep, type SteerStep, type Step, type TextStep, type ToolStep } from "../../../shared/chat.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { is_active_status, is_hidden_step } from "../tools/tool-meta.ts";
import { is_step_group, live_thought, shown_step, work_tools, type WorkStep } from "../tools/work-steps.ts";

export type Block =
  | { kind: "reasoning"; id: string; step: ReasoningStep }
  | { kind: "text"; id: string; step: TextStep }
  | { kind: "work"; id: string; steps: WorkStep[] }
  | { kind: "plan"; id: string; step: ToolStep; text: string }
  | { kind: "image"; id: string; step: ToolStep; view: Extract<ToolView, { kind: "image" }> }
  | { kind: "visual"; id: string; step: ToolStep; view: Extract<ToolView, { kind: "visual" }> }
  | { kind: "steer"; id: string; step: SteerStep }
  | { kind: "notice"; id: string; step: NoticeStep }
  | { kind: "compaction"; id: string; step: CompactionStep };

const hidden_notices: ReadonlySet<NoticeKind> = new Set(["peer_digest", "agent_roster", "todos_carried", "update_reminder"]);

const plain_block = (step: TextStep | SteerStep | NoticeStep | CompactionStep): Block | null => {
  switch (step.kind) {
    case "text":
      return step.text.trim() ? { kind: "text", id: step.id, step } : null;
    case "steer":
      return { kind: "steer", id: step.id, step };
    case "notice":
      return hidden_notices.has(step.notice) ? null : { kind: "notice", id: step.id, step };
    case "compaction":
      return { kind: "compaction", id: step.id, step };
  }
};

const separate_block = (step: ToolStep): Block | null => {
  if (step.view?.kind === "plan") {
    return { kind: "plan", id: step.id, step, text: step.view.text };
  }
  if (step.view?.kind === "image" && step.view.images.length > 0) {
    return { kind: "image", id: step.id, step, view: step.view };
  }
  if (step.status === "done" && step.view?.kind === "visual") {
    return { kind: "visual", id: step.id, step, view: step.view };
  }
  return null;
};

const stretch_blocks = (stretch: WorkStep[]): Block[] => {
  const first = stretch[0];
  if (first && work_tools(stretch).length > 0 && stretch.filter(shown_step).length > 1) {
    return [{ kind: "work", id: first.id, steps: stretch }];
  }
  return stretch.map((step): Block => (step.kind === "tool" ? { kind: "work", id: step.id, steps: [step] } : { kind: "reasoning", id: step.id, step }));
};

export const build_blocks = (steps: Step[]): Block[] => {
  const blocks: Block[] = [];
  const stretch: WorkStep[] = [];
  const close_stretch = () => blocks.push(...stretch_blocks(stretch.splice(0)));
  for (const step of steps) {
    if (step.kind === "reasoning") {
      stretch.push(step);
      continue;
    }
    if (step.kind === "tool") {
      if (is_hidden_step(step)) {
        continue;
      }
      const separate = separate_block(step);
      if (!separate) {
        stretch.push(step);
        continue;
      }
      close_stretch();
      blocks.push(separate);
      continue;
    }
    const block = plain_block(step);
    if (block) {
      close_stretch();
      blocks.push(block);
    }
  }
  close_stretch();
  return blocks;
};

export const is_live_block = (block: Block | undefined): boolean => {
  switch (block?.kind) {
    case "reasoning":
      return block.step.ended_at === null;
    case "text":
      return true;
    case "work":
      return work_tools(block.steps).some((step) => is_active_status(step.status)) || live_thought(block.steps) !== null;
    case "compaction":
      return block.step.status === "running" || block.step.status === "waiting";
    default:
      return false;
  }
};

export const shows_thinking = (streaming: boolean, retrying: boolean, blocks: Block[]): boolean => streaming && !retrying && !is_live_block(blocks.at(-1));

export const thinks_in_group = (streaming: boolean, retrying: boolean, blocks: Block[]): boolean => {
  const last = blocks.at(-1);
  return shows_thinking(streaming, retrying, blocks) && last?.kind === "work" && is_step_group(last.steps);
};

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

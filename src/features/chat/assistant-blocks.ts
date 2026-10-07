import type { AssistantMessage, CompactionStep, Message, NoticeStep, ReasoningStep, SteerStep, Step, TextStep, ToolStep } from "../../../shared/chat.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { is_hidden_step } from "../tools/tool-meta.ts";

export type Block =
  | { kind: "reasoning"; id: string; step: ReasoningStep }
  | { kind: "text"; id: string; step: TextStep }
  | { kind: "tools"; id: string; steps: ToolStep[] }
  | { kind: "plan"; id: string; step: ToolStep; text: string }
  | { kind: "image"; id: string; step: ToolStep; view: Extract<ToolView, { kind: "image" }> }
  | { kind: "steer"; id: string; step: SteerStep }
  | { kind: "notice"; id: string; step: NoticeStep }
  | { kind: "compaction"; id: string; step: CompactionStep };

const plain_block = (step: Exclude<Step, ToolStep>): Block | null => {
  switch (step.kind) {
    case "reasoning":
      return { kind: "reasoning", id: step.id, step };
    case "text":
      return step.text ? { kind: "text", id: step.id, step } : null;
    case "steer":
      return { kind: "steer", id: step.id, step };
    case "notice":
      return { kind: "notice", id: step.id, step };
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
    if (step.view?.kind === "image") {
      blocks.push({ kind: "image", id: step.id, step, view: step.view });
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

export const answer_text = (message: AssistantMessage) =>
  message.steps
    .flatMap((step) => (step.kind === "text" && step.text.trim() ? [step.text.trim()] : []))
    .join("\n\n");

type FileChange = { path: string; added: number; removed: number; created: boolean };

export const file_changes = (message: AssistantMessage): FileChange[] => {
  const changes = new Map<string, FileChange>();
  for (const step of message.steps) {
    if (step.kind !== "tool" || step.status !== "done" || step.view?.kind !== "edit") {
      continue;
    }
    const view = step.view;
    const previous = changes.get(view.path);
    changes.set(view.path, {
      path: view.path,
      added: (previous?.added ?? 0) + view.added,
      removed: (previous?.removed ?? 0) + view.removed,
      created: (previous?.created ?? false) || view.created,
    });
  }
  return [...changes.values()];
};

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

export const last_own_send = (messages: Message[]): string => {
  const sent = messages.findLast((message) => message.role === "user" && message.origin !== "background" && message.origin !== "agent_report");
  return sent?.id ?? "";
};

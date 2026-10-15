import { manual_compaction_only, type AssistantMessage } from "../../../shared/chat.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { started_run } from "../tools/tool-meta.ts";
import type { Block } from "./assistant-blocks.ts";

export type HeadState = { kind: "working" } | { kind: "worked"; ms: number } | { kind: "stopped"; ms: number } | { kind: "activity" };

export type TurnShape = { head: HeadState | null; folds: ReadonlySet<string>; foldable: boolean; runs: RunRef[] };

const activity = (block: Block) => block.kind === "reasoning" || block.kind === "tools" || block.kind === "notice" || block.kind === "compaction";

export const foldable_block = (block: Block) => activity(block) || block.kind === "text";

const answer_block = (block: Block) => (block.kind === "text" && block.step.text.trim() !== "") || block.kind === "plan" || block.kind === "image";

const blank_reasoning = (block: Block) => block.kind === "reasoning" && block.step.text.trim() === "";

const continues_answer = (blocks: Block[], index: number): boolean => {
  const block = blocks[index];
  if (block?.kind === "notice") {
    return block.step.notice === "output_limit" && blocks[index - 1]?.kind === "text";
  }
  return block?.kind === "reasoning" && continues_answer(blocks, index - 1);
};

const work_block = (blocks: Block[], index: number): boolean => {
  const block = blocks[index];
  return block !== undefined && activity(block) && !continues_answer(blocks, index) && !blank_reasoning(block);
};

const step_ends = (block: Block): number[] => {
  switch (block.kind) {
    case "reasoning":
    case "plan":
    case "image":
      return block.step.ended_at === null ? [] : [block.step.ended_at];
    case "tools":
      return block.steps.flatMap((step) => (step.ended_at === null ? [] : [step.ended_at]));
    default:
      return [];
  }
};

const ended_at = (message: AssistantMessage) => Date.parse(message.ended_at ?? message.created_at);

const since_start = (message: AssistantMessage, end: number) => Math.max(0, end - Date.parse(message.created_at));

const work_ms = (message: AssistantMessage, blocks: Block[], last: number) => {
  const from = Math.max(last, 0);
  const answer_at = blocks.findIndex((block, index) => index > last && block.kind === "text");
  const ends = blocks.slice(from, answer_at < 0 ? blocks.length : answer_at).flatMap(step_ends);
  return since_start(message, ends.length > 0 ? Math.max(...ends) : ended_at(message));
};

const head_of = (message: AssistantMessage, blocks: Block[], last: number, started: boolean): HeadState | null => {
  switch (message.status) {
    case "streaming":
      return started ? { kind: "working" } : null;
    case "stopped":
      return { kind: "stopped", ms: message.ended_at ? since_start(message, ended_at(message)) : work_ms(message, blocks, last) };
    case "interrupted":
      return started ? { kind: "activity" } : null;
    case "done":
    case "failed":
    case "blocked":
      return started && blocks.some(answer_block) ? { kind: "worked", ms: work_ms(message, blocks, last) } : null;
  }
};

const turn_runs = (message: AssistantMessage): RunRef[] => message.steps.flatMap((step) => (step.kind === "tool" ? (started_run(step) ?? []) : []));

const no_folds: ReadonlySet<string> = new Set();

const no_shape: TurnShape = { head: null, folds: no_folds, foldable: false, runs: [] };

export const turn_shape = (message: AssistantMessage, blocks: Block[]): TurnShape => {
  if (manual_compaction_only(message)) {
    return no_shape;
  }
  const last = blocks.map((_, index) => work_block(blocks, index)).lastIndexOf(true);
  const started = last >= 0 || blocks.some((block) => block.kind === "plan" || block.kind === "image");
  const head = head_of(message, blocks, last, started);
  if (head === null) {
    return no_shape;
  }
  const work = blocks.slice(0, last + 1).filter(foldable_block);
  const trailing_folds = blocks.filter((block, index) => index > last && (continues_answer(blocks, index) || blank_reasoning(block)));
  const answered = blocks.slice(last + 1).some(answer_block);
  const foldable = message.status === "done" && answered && work.some((block) => block.kind !== "compaction");
  return {
    head,
    folds: new Set([...work, ...trailing_folds].map((block) => block.id)),
    foldable,
    runs: foldable ? turn_runs(message) : [],
  };
};

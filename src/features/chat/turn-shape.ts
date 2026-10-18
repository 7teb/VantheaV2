import { manual_compaction_only, type AssistantMessage } from "../../../shared/chat.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { started_run } from "../tools/tool-meta.ts";
import type { Block } from "./assistant-blocks.ts";

export type HeadState = { kind: "working" } | { kind: "worked"; ms: number } | { kind: "stopped"; ms: number } | { kind: "activity" };

export type MemberFacts = { message: AssistantMessage; blocks: Block[]; last: number; started: boolean; folds: ReadonlySet<string> };

export type TurnShape = { head: HeadState | null; folds: ReadonlySet<string>[]; foldable: boolean; runs: RunRef[] };

const activity = (block: Block) => block.kind === "reasoning" || block.kind === "tools" || block.kind === "notice" || block.kind === "compaction";

export const foldable_block = (block: Block) => activity(block) || block.kind === "text";

const answer_block = (block: Block) => (block.kind === "text" && block.step.text.trim() !== "") || block.kind === "plan" || block.kind === "image" || block.kind === "visual";

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
    case "visual":
      return block.step.ended_at === null ? [] : [block.step.ended_at];
    case "tools":
      return block.steps.flatMap((step) => (step.ended_at === null ? [] : [step.ended_at]));
    default:
      return [];
  }
};

const ended_at = (message: AssistantMessage) => Date.parse(message.ended_at ?? message.created_at);

const since = (leader: AssistantMessage, end: number) => Math.max(0, end - Date.parse(leader.created_at));

const work_end = (member: MemberFacts, alone: boolean): number => {
  if (!alone && !member.started) {
    return Date.parse(member.message.created_at);
  }
  const from = Math.max(member.last, 0);
  const answer_at = member.blocks.findIndex((block, index) => index > member.last && block.kind === "text");
  const ends = member.blocks.slice(from, answer_at < 0 ? member.blocks.length : answer_at).flatMap(step_ends);
  return ends.length > 0 ? Math.max(...ends) : ended_at(member.message);
};

const turn_runs = (message: AssistantMessage): RunRef[] => message.steps.flatMap((step) => (step.kind === "tool" ? (started_run(step) ?? []) : []));

const no_folds: ReadonlySet<string> = new Set();

export const member_facts = (message: AssistantMessage, blocks: Block[]): MemberFacts => {
  if (manual_compaction_only(message)) {
    return { message, blocks, last: -1, started: false, folds: no_folds };
  }
  const last = blocks.map((_, index) => work_block(blocks, index)).lastIndexOf(true);
  const started = last >= 0 || blocks.some((block) => block.kind === "plan" || block.kind === "image" || block.kind === "visual");
  const work = blocks.slice(0, last + 1).filter(foldable_block);
  const trailing = blocks.filter((block, index) => index > last && (continues_answer(blocks, index) || blank_reasoning(block)));
  return { message, blocks, last, started, folds: new Set([...work, ...trailing].map((block) => block.id)) };
};

const head_of = (leader: AssistantMessage, last: MemberFacts, started: boolean, alone: boolean): HeadState | null => {
  switch (last.message.status) {
    case "streaming":
      return started ? { kind: "working" } : null;
    case "stopped":
      return { kind: "stopped", ms: since(leader, last.message.ended_at ? ended_at(last.message) : work_end(last, alone)) };
    case "interrupted":
      return started ? { kind: "activity" } : null;
    case "done":
    case "failed":
    case "blocked":
      return started && last.blocks.some(answer_block) ? { kind: "worked", ms: since(leader, work_end(last, alone)) } : null;
  }
};

const whole_cache = new WeakMap<MemberFacts, ReadonlySet<string>>();

const whole_member = (member: MemberFacts): ReadonlySet<string> => {
  const cached = whole_cache.get(member);
  if (cached) {
    return cached;
  }
  const folds = new Set(member.blocks.filter(foldable_block).map((block) => block.id));
  whole_cache.set(member, folds);
  return folds;
};

const has_work = (blocks: Block[]) => blocks.some((block) => foldable_block(block) && block.kind !== "compaction");

export const turn_shape = (members: MemberFacts[]): TurnShape => {
  const leader = members[0];
  const last = members.at(-1);
  const runs = members.flatMap((member) => turn_runs(member.message));
  const none: TurnShape = { head: null, folds: members.map(() => no_folds), foldable: false, runs };
  if (!leader || !last || (members.length === 1 && manual_compaction_only(leader.message))) {
    return none;
  }
  const alone = members.length === 1;
  const head = head_of(leader.message, last, members.some((member) => member.started), alone);
  if (head === null) {
    return none;
  }
  const earlier = members.slice(0, -1);
  const answered = last.blocks.slice(last.last + 1).some(answer_block);
  const worked = earlier.some((member) => has_work(member.blocks)) || has_work(last.blocks.slice(0, last.last + 1));
  return {
    head,
    folds: [...earlier.map(whole_member), last.folds],
    foldable: last.message.status === "done" && answered && worked,
    runs,
  };
};

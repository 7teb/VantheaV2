import type { AssistantMessage, Step } from "../chat.ts";
import { file_changes } from "../file-changes.ts";
import type { OpenQuestion } from "../questions.ts";
import type { ApprovalInfo, ChatActivity, RunResult, RunUsage } from "./contract.ts";

const cut_by_output_limit = (step: Step): boolean => step.kind === "notice" && step.notice === "output_limit";

export const run_text = (steps: readonly Step[]): string => {
  const tail = steps.slice(steps.findLastIndex((step) => step.kind === "tool") + 1);
  let text = "";
  let previous_round: number | null = null;
  let continued = false;
  for (const step of tail) {
    if (cut_by_output_limit(step)) {
      continued = true;
      continue;
    }
    if (step.kind !== "text") {
      continue;
    }
    const joint = previous_round === null || previous_round === step.round || continued ? "" : "\n\n";
    text += joint + step.text;
    previous_round = step.round;
    continued = false;
  }
  return text.trim();
};

export const sum_usage = (messages: readonly AssistantMessage[]): RunUsage =>
  messages.reduce(
    (total, message) =>
      message.usage
        ? {
            prompt_tokens: total.prompt_tokens + message.usage.prompt_tokens,
            completion_tokens: total.completion_tokens + message.usage.completion_tokens,
            reasoning_tokens: total.reasoning_tokens + message.usage.reasoning_tokens,
            rounds: total.rounds + message.usage.rounds,
          }
        : total,
    { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, rounds: 0 },
  );

const presented_plan = (message: AssistantMessage): boolean =>
  message.status === "done" && message.steps.some((step) => step.kind === "tool" && step.name === "present_plan" && step.status === "done");

export const build_run_result = (input: {
  run_id: string;
  session_id: string;
  settled: boolean;
  messages: AssistantMessage[];
  questions: OpenQuestion[];
  approvals: ApprovalInfo[];
  active: ChatActivity;
  started_at: string;
}): RunResult => {
  const last = input.messages.at(-1);
  const status = input.settled && last && last.status !== "streaming" ? last.status : "running";
  return {
    run_id: input.run_id,
    session_id: input.session_id,
    status,
    error: last?.error ?? null,
    text: last ? run_text(last.steps) : "",
    messages: input.messages,
    needs_input: {
      questions: input.questions,
      approvals: input.approvals,
      plan_message_id: last && presented_plan(last) ? last.id : null,
    },
    active: input.active,
    changed_files: file_changes(input.messages.flatMap((message) => message.steps)),
    usage: sum_usage(input.messages),
    started_at: input.started_at,
    ended_at: status === "running" ? null : (last?.ended_at ?? null),
  };
};

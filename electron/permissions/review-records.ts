import type { Message, ToolStep } from "../../shared/chat.ts";
import type { ReviewActor, ReviewRecord } from "../../shared/review.ts";
import { get_chat } from "../chats/store.ts";
import type { ActorReview, ReviewModelCall } from "../tools/types.ts";
import { command_tools, update_tool_step } from "./decisions.ts";

export const main_actor: ReviewActor = { id: "main", name: "main", kind: "main" };

export type AgentScope = {
  chat_id: string;
  agent_id: string;
  name: string;
  parent_message_id: string;
  parent_call_id: string;
  live_steps: () => ToolStep[];
};

export const tool_steps_in = (messages: Message[]): ToolStep[] =>
  messages.flatMap((message) => (message.role === "assistant" ? message.steps.filter((step): step is ToolStep => step.kind === "tool") : []));

export const reviews_in = (steps: ToolStep[]): ReviewRecord[] => {
  const by_id = new Map<string, ReviewRecord>();
  for (const step of steps) {
    for (const record of step.reviews ?? []) {
      by_id.set(record.id, record);
    }
  }
  return [...by_id.values()].sort((a, b) => a.at - b.at);
};

const chat_steps = async (chat_id: string): Promise<ToolStep[]> => {
  const chat = await get_chat(chat_id);
  if (!chat) {
    console.warn(`[reviews] chat ${chat_id} is not available, reviewing without its earlier records`);
    return [];
  }
  return tool_steps_in(chat.messages);
};

export const main_review = (chat_id: string, call: ReviewModelCall): ActorReview => ({
  actor: main_actor,
  call,
  history: async () => {
    const steps = await chat_steps(chat_id);
    return { records: reviews_in(steps), steps, earlier_commands: 0 };
  },
});

export const mirror_review = (chat_id: string, message_id: string, call_id: string, record: ReviewRecord): Promise<void> =>
  update_tool_step(chat_id, message_id, call_id, `review ${record.id} of ${record.actor.name}`, (step) => ({
    ...step,
    reviews: [...(step.reviews ?? []).filter((entry) => entry.id !== record.id), record],
  }));

export const agent_review = (scope: AgentScope, call: ReviewModelCall): ActorReview => ({
  actor: { id: scope.agent_id, name: scope.name, kind: "agent" },
  call,
  history: async () => {
    const live = scope.live_steps();
    const records = reviews_in([...(await chat_steps(scope.chat_id)), ...live]);
    const current = new Set(live.flatMap((step) => (step.reviews ?? []).map((record) => record.id)));
    const earlier_commands = records.filter((record) => record.actor.id === scope.agent_id && !current.has(record.id) && command_tools.includes(record.tool)).length;
    return { records, steps: live, earlier_commands };
  },
  mirror: (record) => mirror_review(scope.chat_id, scope.parent_message_id, scope.parent_call_id, record),
});

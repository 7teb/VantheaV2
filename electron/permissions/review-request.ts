import { randomBytes } from "node:crypto";
import type { ReviewCall } from "../tools/types.ts";
import { current_part, type ActionView } from "./review-action.ts";
import { review_schema, review_schema_name } from "./review-answer.ts";
import { estimate_review_tokens, fit_scripts, largest_sent, request_cap_tokens, trim_steps } from "./review-budget.ts";
import { action_lines, decision_feed, type FeedLine, type FeedSource } from "./review-lines.ts";
import { review_system_prompt } from "./review-prompt.ts";
import type { AgentView, ChatView } from "./review-sections.ts";
import { review_parts } from "./review-state.ts";
import { retained_scripts, type RetainedScript } from "./script-retention.ts";

export type ReviewInput = {
  chat: ChatView;
  chat_key: string;
  agent: AgentView;
  source: FeedSource;
  mark: string | null;
  call_id: string;
  action: ActionView;
};

export type AssembledReview = {
  call: ReviewCall;
  estimated_tokens: number;
  too_large: boolean;
  lines: FeedLine[];
  sent: ReadonlySet<string>;
  gaps: string[];
  script_gaps: string[];
  retained: RetainedScript[];
};

const random_tag = (): string => randomBytes(6).toString("hex");

const review_session_id = (chat_id: string): string => `vx-review:${chat_id}`.slice(0, 256);

export const assemble_review = (input: ReviewInput, new_tag: () => string = random_tag): AssembledReview => {
  const lines = decision_feed(input.source, input.agent.actor, input.mark);
  const actions = action_lines(input.source.steps, lines, input.call_id);
  const retained = retained_scripts(input.source.records, input.agent.actor);
  const system_tokens = estimate_review_tokens(review_system_prompt);
  const build = (level: number, dropped: ReadonlySet<string>) => {
    const { parts, tag } = review_parts({ chat: input.chat, chat_key: input.chat_key, agent: input.agent, feed: lines, actions, retained }, level, new_tag);
    const placement = fit_scripts(input.action.files, undefined, dropped);
    const current = current_part(input.action, placement, retained, tag);
    const all = [...parts, { text: current.text, marker: false }];
    const estimated_tokens = system_tokens + all.reduce((total, part) => total + estimate_review_tokens(part.text), 0);
    const call: ReviewCall = {
      session_id: review_session_id(input.chat.chat_id),
      system: review_system_prompt,
      parts: all,
      schema: { name: review_schema_name, schema: review_schema },
    };
    return { call, estimated_tokens, sent: placement.sent, gaps: current.gaps, script_gaps: current.script_gaps };
  };
  const result = (built: ReturnType<typeof build>, too_large: boolean): AssembledReview => ({ ...built, too_large, lines, retained });
  for (let level = 0; level < trim_steps.length; level += 1) {
    const built = build(level, new Set());
    if (built.estimated_tokens <= request_cap_tokens) {
      return result(built, false);
    }
  }
  const dropped = new Set<string>();
  for (;;) {
    const built = build(trim_steps.length, dropped);
    if (built.estimated_tokens <= request_cap_tokens) {
      return result(built, false);
    }
    const largest = largest_sent(input.action.files, built.sent);
    if (!largest) {
      return result(built, true);
    }
    dropped.add(largest.id);
  }
};

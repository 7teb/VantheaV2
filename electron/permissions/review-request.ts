import { randomBytes } from "node:crypto";
import type { ReviewCall } from "../tools/types.ts";
import { current_part, type ActionView } from "./review-action.ts";
import { review_schema, review_schema_name } from "./review-answer.ts";
import { estimate_review_tokens, fit_scripts, recent_human_messages, request_cap_tokens, section_caps, trim_steps, trimmed } from "./review-budget.ts";
import { action_lines, decision_feed, type FeedLine, type FeedSource } from "./review-lines.ts";
import { review_system_prompt } from "./review-prompt.ts";
import { human_line_bytes, type AgentView, type ChatView } from "./review-sections.ts";
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
  retained: RetainedScript[];
};

const random_tag = (): string => randomBytes(6).toString("hex");

const review_session_id = (chat_id: string): string => `vx-review:${chat_id}`.slice(0, 256);

export const assemble_review = (input: ReviewInput, cap_tokens: number = request_cap_tokens, new_tag: () => string = random_tag): AssembledReview => {
  const lines = decision_feed(input.source, input.agent.actor, input.mark);
  const actions = action_lines(input.source.steps, lines, input.call_id);
  const retained = retained_scripts(input.source.records, input.agent.actor);
  const system_tokens = estimate_review_tokens(review_system_prompt);
  const build = (level: number, budget: number, dropped_humans: number) => {
    const { parts, tag } = review_parts({ chat: input.chat, chat_key: input.chat_key, agent: input.agent, feed: lines, actions, retained }, level, dropped_humans, new_tag);
    const placement = fit_scripts(input.action.files, budget, retained);
    const current = current_part(input.action, placement, retained, tag, level);
    const all = [...parts, { text: current.text, marker: false }];
    const estimated_tokens = system_tokens + all.reduce((total, part) => total + estimate_review_tokens(part.text), 0);
    const call: ReviewCall = {
      session_id: review_session_id(input.chat.chat_id),
      system: review_system_prompt,
      parts: all,
      schema: { name: review_schema_name, schema: review_schema },
    };
    return { review: { call, estimated_tokens, sent: placement.sent, gaps: current.gaps }, script_tokens: placement.tokens };
  };
  const result = (built: ReturnType<typeof build>, too_large: boolean): AssembledReview => ({ ...built.review, too_large, lines, retained });
  for (let level = 0; level < trim_steps.length; level += 1) {
    const built = build(level, trimmed(level, "scripts_run") ? section_caps.scripts_run : cap_tokens, 0);
    if (built.review.estimated_tokens <= cap_tokens) {
      return result(built, false);
    }
  }
  const line_bytes = human_line_bytes(input.chat.humans, trim_steps.length);
  const droppable = Math.max(0, line_bytes.length - recent_human_messages);
  let dropped = 0;
  let fitted = build(trim_steps.length, section_caps.scripts_run, dropped);
  while (fitted.review.estimated_tokens > cap_tokens && dropped < droppable) {
    for (let left = (fitted.review.estimated_tokens - cap_tokens) * 2; left > 0 && dropped < droppable; dropped += 1) {
      left -= line_bytes[dropped] ?? 0;
    }
    fitted = build(trim_steps.length, section_caps.scripts_run, dropped);
  }
  if (fitted.review.estimated_tokens <= cap_tokens) {
    return result(fitted, false);
  }
  let budget: number = section_caps.scripts_run;
  for (;;) {
    const built = build(trim_steps.length, budget, dropped);
    const over = built.review.estimated_tokens - cap_tokens;
    if (over <= 0 || budget === 0) {
      return result(built, over > 0);
    }
    budget = Math.max(0, built.script_tokens - over);
  }
};

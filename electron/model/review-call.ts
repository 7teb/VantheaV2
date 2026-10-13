import { review_deadline_ms } from "../../shared/review.ts";
import type { ReviewCall, ReviewReply } from "../tools/types.ts";
import { complete } from "./complete.ts";
import { review_request } from "./review-body.ts";
import type { Transport } from "./transport.ts";

export type ReviewLimits = { attempt_ms: number; deadline_ms: number; attempts: number; transport?: Partial<Transport> };

export const review_limits: ReviewLimits = { attempt_ms: 30000, deadline_ms: review_deadline_ms, attempts: 2 };

export const review_completion = async (model_id: string, call: ReviewCall, signal: AbortSignal, limits: ReviewLimits = review_limits): Promise<ReviewReply> => {
  const started = Date.now();
  const result = await complete(
    review_request(model_id, call),
    AbortSignal.any([signal, AbortSignal.timeout(limits.deadline_ms)]),
    { ...limits.transport, first_byte_ms: limits.attempt_ms, max_attempts: limits.attempts },
  );
  return {
    text: result.text,
    finish_reason: result.meta.finish_reason,
    usage: {
      prompt_tokens: result.usage?.prompt_tokens ?? 0,
      estimated_tokens: 0,
      cached_tokens: result.meta.cached_tokens,
      cache_write_tokens: result.meta.cache_write_tokens,
      completion_tokens: result.usage?.completion_tokens ?? 0,
      reasoning_tokens: result.usage?.reasoning_tokens ?? 0,
      cost: result.meta.cost,
      ms: Date.now() - started,
    },
  };
};

import type { ReviewAnswer, ReviewFailure, ReviewUsage } from "../../shared/review.ts";
import { ModelError } from "../model/errors.ts";
import { error_text } from "../storage/coerce.ts";
import type { Reviewer } from "../tools/types.ts";
import { parse_review_answer } from "./review-answer.ts";
import type { AssembledReview } from "./review-request.ts";

export type ReviewOutcome =
  | { kind: "answer"; answer: ReviewAnswer; workaround: string | null; usage: ReviewUsage | null }
  | { kind: "failure"; failure: ReviewFailure; usage: ReviewUsage | null };

const failure_kind = (error: unknown): ReviewFailure => {
  if (error instanceof ModelError) {
    switch (error.kind) {
      case "timeout":
        return "timeout";
      case "provider_unavailable":
        return error.status === null ? "network" : "provider";
      case "stream_interrupted":
        return "network";
      case "rate_limited":
        return "rate_limited";
      case "auth":
        return "auth";
      case "credits":
        return "credits";
      case "policy":
        return "refused";
      case "context_limit":
        return "too_large";
      default:
        return "provider";
    }
  }
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "provider";
};

export const run_review = async (reviewer: Pick<Reviewer, "call">, instance: string, assembled: AssembledReview, signal: AbortSignal): Promise<ReviewOutcome> => {
  try {
    const reply = await reviewer.call(assembled.call, signal);
    const usage = reply.usage ? { ...reply.usage, estimated_tokens: assembled.estimated_tokens } : null;
    const parsed = parse_review_answer(reply.text, reply.finish_reason, {
      blocking: new Set(assembled.lines.filter((line) => line.blocking).map((line) => line.id)),
      known: new Set(assembled.lines.map((line) => line.id)),
      scripts: assembled.sent.size > 0,
    });
    return parsed.kind === "answer" ? { kind: "answer", answer: parsed.answer, workaround: parsed.workaround, usage } : { kind: "failure", failure: "unreadable", usage };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    const failure = failure_kind(error);
    console.warn(`[permissions] automatic review of ${instance} failed (${failure}): ${error_text(error)}`);
    return { kind: "failure", failure, usage: null };
  }
};

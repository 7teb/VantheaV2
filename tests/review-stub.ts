import type { ReviewActor, ReviewRecord } from "../shared/review.ts";
import type { ActorReview, Reviewer, ReviewCall, ReviewHistory } from "../electron/tools/types.ts";
import { tool_model } from "./tool-model.ts";

export type ReviewStub = Reviewer & Required<Pick<ActorReview, "mirror">> & { records: ReviewRecord[]; calls: ReviewCall[]; queue: (string | Error)[] };

export const main_review_actor: ReviewActor = { id: "main", name: "main", kind: "main" };

export const answer = (decision: "allow" | "review" | "deny", reason = "test", extra: Record<string, string> = {}): string =>
  JSON.stringify({ rule_source: "none", rule: "", workaround_of: "", script_summary: "", reason, decision, ...extra });

export const review_stub = (answers: (string | Error)[] = [], actor: ReviewActor = main_review_actor, history?: () => Promise<ReviewHistory>): ReviewStub => {
  const stub: ReviewStub = {
    actor,
    model: tool_model,
    records: [],
    calls: [],
    queue: [...answers],
    call: async (call) => {
      stub.calls.push(call);
      const next = stub.queue.shift();
      if (next === undefined) {
        throw new Error("no review expected");
      }
      if (next instanceof Error) {
        throw next;
      }
      return { text: next, finish_reason: "stop", usage: null };
    },
    history: history ?? (async () => ({ records: [...stub.records], steps: [], earlier_commands: 0 })),
    record: async (entry) => {
      stub.records = [...stub.records.filter((record) => record.id !== entry.id), entry];
    },
    mirror: async (entry) => {
      stub.records = [...stub.records.filter((record) => record.id !== entry.id), entry];
    },
  };
  return stub;
};

import type { ReviewRecord } from "../../../shared/review.ts";

export const review_record = (id: string, extra: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id,
  at: 1_760_000_000_000,
  actor: { id: "main", name: "main", kind: "main" },
  tool: "run_command",
  subject: "npm.cmd test",
  cwd: "D:/project",
  verdict: "allow",
  source: "model",
  reason: "Runs the project's own tests.",
  rule_source: "none",
  rule: "",
  last_human_id: "u1",
  ...extra,
});

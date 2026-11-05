import assert from "node:assert/strict";
import { test } from "node:test";
import { fit_retained, retained_line, retained_scripts } from "../electron/permissions/script-retention.ts";
import type { ReviewActor, ReviewScript } from "../shared/review.ts";
import { review_record } from "./fixtures/review/record.ts";

const main: ReviewActor = { id: "main", name: "main", kind: "main" };
const worker: ReviewActor = { id: "agent_1a2b3c4d-0000", name: "worker", kind: "agent" };

const script = (sha: string, extra: Partial<ReviewScript> = {}): ReviewScript => ({ path: "tools/x.ps1", sha256: sha.repeat(64), role: "started", chars: 10, sent: true, summary: `summary ${sha}`, change: null, ...extra });

test("one line per path and hash, strictest verdict, no text", () => {
  const records = [
    review_record("r1", { at: 1, scripts: [script("a")] }),
    review_record("r2", { at: 2, verdict: "deny", scripts: [script("a", { summary: null })] }),
    review_record("r3", { at: 3, scripts: [script("b", { change: "written" })] }),
  ];
  const lines = retained_scripts(records, main).map(retained_line);
  assert.deepEqual(lines, [
    JSON.stringify({ path: "tools/x.ps1", hash: "a".repeat(16), verdict: "deny", summary: "summary a", chars: 10, role: "started" }),
    JSON.stringify({ path: "tools/x.ps1", hash: "b".repeat(16), verdict: "allow", summary: "summary b", chars: 10, role: "started", change: "written" }),
  ]);
});

test("a sub-agent sees main's review and deny scripts with by, never main's allows", () => {
  const records = [
    review_record("r1", { scripts: [script("a")] }),
    review_record("r2", { verdict: "review", scripts: [script("b")] }),
    review_record("r3", { actor: worker, scripts: [script("c", { sent: false, summary: null })] }),
  ];
  const lines = retained_scripts(records, worker).map(retained_line);
  assert.deepEqual(lines, [
    JSON.stringify({ path: "tools/x.ps1", hash: "b".repeat(16), verdict: "review", summary: "summary b", chars: 10, role: "started", by: "main" }),
    JSON.stringify({ path: "tools/x.ps1", hash: "c".repeat(16), verdict: "allow", chars: 10, role: "started", sent: false }),
  ]);
});

test("allow-only lines leave first with a count line, review and deny lines stay", () => {
  const records = Array.from({ length: 30 }, (_, index) => review_record(`r${index}`, { at: index, verdict: index === 5 ? "deny" : "allow", scripts: [script(String.fromCharCode(97 + (index % 26)), { path: `s/${index}.ps1` })] }));
  const lines = fit_retained(retained_scripts(records, main), 2000, false);
  assert.match(lines[0] ?? "", /^\(\d+ earlier allowed scripts not shown\)$/);
  assert.ok(lines.some((line) => line.includes('"s/5.ps1"') && line.includes('"verdict":"deny"')));
  assert.ok(lines.join("\n").length <= 2100);
});

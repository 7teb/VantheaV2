import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { clear_authorization } from "../electron/permissions/context.ts";
import { forget_instruction_files } from "../electron/permissions/instruction-files.ts";
import { review_headers } from "../electron/permissions/review-prompt.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";
import { forget_chat_writes } from "../electron/permissions/written-files.ts";
import type { Message, Step } from "../shared/chat.ts";
import { at_message, golden_chat_id, worker } from "./fixtures/review/golden.ts";
import { golden_review, prepare_golden } from "./fixtures/review/golden-build.ts";
import { review_record } from "./fixtures/review/record.ts";

let root = "";
let messages: Message[] = [];

const with_steps = (list: Message[], id: string, change: (steps: Step[]) => Step[]): Message[] =>
  list.map((message) => (message.id === id && message.role === "assistant" ? { ...message, steps: change(message.steps) } : message));

const unanswered = (list: Message[]) => with_steps(list, "a12", (steps) => steps.map((step) => (step.kind === "tool" ? { ...step, decisions: [] } : step)));

const late_record = review_record("r-late", {
  at: at_message(15, 1),
  last_human_id: "u12",
  actor: worker,
  subject: "npm run lint --workspace worker",
  verdict: "review",
  reason: "Runs a lint script the worker changed; no message asked for it.",
});

const with_late_review = (list: Message[]) =>
  with_steps(list, "a30", (steps) => steps.map((step) => (step.kind === "tool" && step.call_id === "c30_0" ? { ...step, reviews: [...(step.reviews ?? []), late_record] } : step)));

const decision_ids = (text: string): Map<string, string> => {
  const ids = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    const fields = JSON.parse(line) as { id?: string; action?: string };
    if (fields.id && fields.action) ids.set(fields.action, fields.id);
  }
  return ids;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-review-cache-"));
  messages = await prepare_golden(root);
});

after(async () => {
  clear_review_chat(golden_chat_id);
  clear_authorization(golden_chat_id);
  forget_instruction_files(golden_chat_id);
  forget_chat_writes(golden_chat_id);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a changed status and a late review of another agent only add a later block, so the cached prefix stays", async () => {
  clear_review_chat(golden_chat_id);
  const first = await golden_review(root, unanswered(messages), "main");
  const next = await golden_review(root, with_late_review(messages), "main");
  const stable = first.call.parts.slice(0, -1).map((part) => part.text);
  assert.deepEqual(next.call.parts.slice(0, stable.length).map((part) => part.text), stable);
  assert.equal(next.call.parts.length, first.call.parts.length + 1);
  const later = next.call.parts.at(-2)?.text ?? "";
  assert.ok(later.startsWith(`${review_headers.earlier_decisions}:\n`), later);
  const before_ids = decision_ids(stable.join(""));
  const later_ids = decision_ids(later);
  const install = "npm install -g typescript@5.9";
  assert.equal(later_ids.get(install), before_ids.get(install));
  assert.ok(later_ids.has("npm run lint --workspace worker"));
  assert.ok(![...before_ids.values()].includes(later_ids.get("npm run lint --workspace worker") ?? ""));
});

test("a fresh build numbers the decisions in time order as before", async () => {
  clear_review_chat(golden_chat_id);
  const built = await golden_review(root, with_late_review(messages), "main");
  const ids = [...decision_ids(built.call.parts.map((part) => part.text).join("")).values()].map((id) => Number(id.slice(1)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

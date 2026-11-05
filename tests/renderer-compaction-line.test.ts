import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AssistantMessage, CompactionStep, Message, Step, ToolStep } from "../shared/chat.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { compaction_key, compaction_text, compaction_wait_text, slow_notice_delay, slow_notice_ms, stepless_summary_after } from "../src/features/chat/compaction-line.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const line = (status: CompactionStep["status"], source?: CompactionStep["source"]): CompactionStep => ({
  id: "compaction:1",
  round: 1,
  kind: "compaction",
  status,
  ...(source ? { source } : {}),
  started_at: 1000,
});

test("the compaction line names each state in English and German", () => {
  const cases: [CompactionStep, string, string][] = [
    [line("running", "auto"), "Compacting context", "Kontext wird komprimiert"],
    [line("done", "auto"), "Context automatically compacted", "Kontext automatisch komprimiert"],
    [line("done", "manual"), "Context compacted", "Kontext komprimiert"],
    [line("done"), "Context automatically compacted", "Kontext automatisch komprimiert"],
    [line("failed", "auto"), "Context compaction failed", "Kontext-Komprimierung fehlgeschlagen"],
    [line("interrupted", "manual"), "Compaction interrupted", "Komprimierung unterbrochen"],
  ];
  for (const [step, en, de] of cases) {
    assert.equal(translate("en", compaction_key(step)), en);
    assert.equal(translate("de", compaction_key(step)), de);
  }
  assert.equal(translate("en", "context.compacting_slow"), "This can take a few minutes");
  assert.equal(translate("de", "context.compacting_slow"), "Das kann einige Minuten dauern");
});

test("the slow notice appears ten seconds after the compaction started, also when the line mounts later", () => {
  const step = line("running", "auto");
  assert.equal(slow_notice_delay(step, 1000), slow_notice_ms);
  assert.equal(slow_notice_delay(step, 7000), 4000);
  assert.equal(slow_notice_delay(step, 30_000), 0);
});

test("the compaction line is a standalone block, never part of a tool group", () => {
  const tool = (index: number): ToolStep => ({
    id: `tool:${index}`,
    round: index,
    kind: "tool",
    index: 0,
    call_id: `c${index}`,
    name: "read_file",
    args: {},
    status: "done",
    progress: null,
    approval: null,
    view: null,
    error: null,
    result_text: "",
    started_at: null,
    ended_at: null,
  });
  const steps: Step[] = [tool(0), line("done", "auto"), tool(1)];
  assert.deepEqual(
    build_blocks(steps).map((block) => block.kind),
    ["work", "compaction", "work"],
  );
});

const in_language = (language: "en" | "de"): Translate => (key, vars) => translate(language, key, vars);

test("the retry, waiting and final failure states name the attempt, the reason and the next try in English and German", () => {
  const retrying: CompactionStep = { ...line("running", "auto"), attempt: 3, attempts: 14 };
  const retry_at = new Date(2026, 9, 12, 14, 32, 5).getTime();
  const waiting: CompactionStep = { ...line("waiting", "auto"), attempt: 4, attempts: 14, retry_at, error: { kind: "provider_unavailable", message: "OpenRouter 503: down" } };
  const failed: CompactionStep = { ...line("failed", "manual"), error: { kind: "empty_note", message: "m returned an empty compaction note" } };
  assert.equal(compaction_text(in_language("en"), line("running", "auto")), "Compacting context");
  assert.equal(compaction_text(in_language("en"), { ...line("running", "auto"), attempt: 1, attempts: 14 }), "Compacting context");
  assert.equal(compaction_text(in_language("en"), retrying), "Compacting context, attempt 3 of 14");
  assert.equal(compaction_text(in_language("de"), retrying), "Kontext wird komprimiert, Versuch 3 von 14");
  assert.equal(compaction_text(in_language("en"), waiting), "Compacting context, attempt 4 of 14");
  assert.equal(compaction_text(in_language("de"), waiting), "Kontext wird komprimiert, Versuch 4 von 14");
  assert.equal(compaction_wait_text(in_language("en"), waiting, retry_at - 42_000), "provider not reachable · retrying in 42s");
  assert.equal(compaction_wait_text(in_language("de"), waiting, retry_at - 42_000), "Anbieter nicht erreichbar · neuer Versuch in 42 s");
  assert.equal(compaction_wait_text(in_language("en"), waiting, retry_at - 1500), "provider not reachable · retrying in 2s");
  assert.equal(compaction_wait_text(in_language("en"), waiting, retry_at), "provider not reachable");
  assert.equal(compaction_wait_text(in_language("de"), waiting, retry_at + 3000), "Anbieter nicht erreichbar");
  const first_wait: CompactionStep = { ...line("waiting", "auto"), attempt: 1, attempts: 14, retry_at, error: { kind: "rate_limited", message: "429 temporarily rate-limited upstream" } };
  assert.equal(compaction_text(in_language("en"), first_wait), "Compacting context");
  assert.equal(compaction_wait_text(in_language("en"), first_wait, retry_at - 2000), "rate limited · retrying in 2s");
  assert.equal(compaction_text(in_language("en"), failed), "Context compaction failed: empty note");
  assert.equal(compaction_text(in_language("de"), failed), "Kontext-Komprimierung fehlgeschlagen: leere Notiz");
  assert.equal(compaction_text(in_language("en"), line("failed", "auto")), "Context compaction failed");
});

const css_block = (text: string, head: string): string => {
  const start = text.indexOf(head);
  assert.ok(start >= 0, head);
  let depth = 0;
  for (let index = text.indexOf("{", start); index < text.length; index += 1) {
    depth += text[index] === "{" ? 1 : text[index] === "}" ? -1 : 0;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
};

test("the slow notice keeps its 10 s delay with reduced motion, in the same layer as the rule that zeroes delays", () => {
  const motion = readFileSync(new URL("../src/styles/motion.css", import.meta.url), "utf8");
  assert.match(motion.trimStart(), /^@layer motion \{/);
  const reduced = css_block(motion, "@media (prefers-reduced-motion: reduce)");
  assert.match(reduced, /animation-delay: 0ms !important/);
  assert.match(css_block(reduced, ".delayed-reveal"), /animation-delay: var\(--reveal-delay, 0s\) !important/);
  assert.match(css_block(motion, ".delayed-reveal {"), /animation: delayed-reveal 0s var\(--reveal-delay, 0s\) both/);
  const row = readFileSync(new URL("../src/features/chat/StepRows.tsx", import.meta.url), "utf8");
  assert.match(row, /const \[delay\] = useState\(\(\) => slow_notice_delay\(step, Date\.now\(\)\)\);/);
  assert.match(row, /className="delayed-reveal" style=\{\{ "--reveal-delay": `\$\{delay\}ms` \}/);
});

const reply = (id: string, steps: Step[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:00.000Z",
  ended_at: "2026-10-12T10:00:01.000Z",
  status: "done",
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
});

test("a summary without a compaction step gets the plain line after its boundary message, stepped summaries do not", () => {
  const ask: Message = { id: "u1", role: "user", text: "go", attachments: [], origin: "user", created_at: "2026-10-12T10:00:00.000Z" };
  const plain = [ask, reply("a1", []), reply("a2", [])];
  assert.equal(stepless_summary_after(plain, { text: "old", through_message_id: "a1" }), "a1");
  assert.equal(stepless_summary_after(plain, null), null);
  assert.equal(stepless_summary_after(plain, { text: "old", through_message_id: "gone" }), null);
  const later_step = [ask, reply("a1", []), reply("a2", [line("done")])];
  assert.equal(stepless_summary_after(later_step, { text: "auto", through_message_id: "a1" }), null);
  const own_step = [ask, reply("a1", [line("done", "manual")])];
  assert.equal(stepless_summary_after(own_step, { text: "new", through_message_id: "a1", through_round: -1 }), null);
  const failed_only = [ask, reply("a1", [line("failed", "manual")])];
  assert.equal(stepless_summary_after(failed_only, { text: "old", through_message_id: "a1" }), "a1");
});

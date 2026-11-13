import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReasoningStep, Step, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { build_blocks, is_live_block, shows_thinking, thinks_in_group, type Block } from "../src/features/chat/assistant-blocks.ts";
import { group_head } from "../src/features/tools/group-head.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const tool = (id: string, name: string, started: number | null, ended: number | null, args: Record<string, unknown> = {}, view: ToolView | null = null): ToolStep => ({
  id,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call_${id}`,
  name,
  args,
  status: ended === null ? (started === null ? "drafting" : "running") : "done",
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "ok",
  started_at: started,
  ended_at: ended,
});

const thought = (id: string, started: number, ended: number | null, text = "Looking at the packer", status_line?: string): ReasoningStep => ({
  id,
  round: 1,
  kind: "reasoning",
  text,
  started_at: started,
  ended_at: ended,
  ...(status_line ? { status_line } : {}),
});

const text = (id: string, value: string): Step => ({ id, round: 1, kind: "text", text: value });

const shape = (blocks: Block[]) => blocks.map((block) => (block.kind === "work" ? `work:${block.steps.map((step) => step.id).join(",")}` : `${block.kind}:${block.id}`));

const read = (id: string, started: number, ended: number | null) => tool(id, "read_file", started, ended, { path: `${id}.py` });

test("one work block collects the tools and thoughts of a stretch, the answer text ends it", () => {
  const steps: Step[] = [thought("r1", 0, 6_000), read("a1", 6_000, 7_000), thought("r2", 7_000, 9_000), read("a2", 9_000, 10_000), text("t1", "Found it."), thought("r3", 11_000, 12_000), read("a3", 12_000, 13_000)];
  assert.deepEqual(shape(build_blocks(steps)), ["work:r1,a1,r2,a2", "text:t1", "work:r3,a3"]);
});

test("a stretch ends at a steer, a visible notice, a compaction, a plan, an image and a finished visual, not at hidden steps or empty or blank text", () => {
  const plan = tool("pl", "present_plan", 1, 2, {}, { kind: "plan", text: "1. fix" });
  const image = tool("im", "present_images", 1, 2, {}, { kind: "image", images: [{ id: "img.png", width: 1, height: 1 }] });
  const steer: Step = { id: "s1", round: 2, kind: "steer", text: "also the tests" };
  const notice: Step = { id: "n1", round: 2, kind: "notice", notice: "context_trimmed", text: "" };
  const hidden_notice: Step = { id: "n2", round: 2, kind: "notice", notice: "peer_digest", text: "" };
  const compaction: Step = { id: "c1", round: 2, kind: "compaction", status: "done", source: "auto" };
  const hidden_tool = tool("h1", "read_attachment", 1, 2);
  const breakers: [Step, string][] = [
    [steer, "steer:s1"],
    [notice, "notice:n1"],
    [compaction, "compaction:c1"],
    [plan, "plan:pl"],
    [image, "image:im"],
  ];
  for (const [breaker, label] of breakers) {
    assert.deepEqual(shape(build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, 2_000), breaker, thought("r2", 3_000, 4_000), read("a2", 4_000, 5_000)])), ["work:r1,a1", label, "work:r2,a2"], label);
  }
  const quiet = build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, 2_000), hidden_notice, hidden_tool, text("t0", ""), text("t1", "\n\n"), thought("r2", 3_000, 4_000), read("a2", 4_000, 5_000)]);
  assert.deepEqual(shape(quiet), ["work:r1,a1,r2,a2"]);
});

test("agent reports, agent updates and agent messages join the stretch as rows", () => {
  const notice = (id: string, kind: "agent_report" | "agent_update" | "peer_message" | "peer_status"): Step => ({ id, round: 2, kind: "notice", notice: kind, text: "" });
  for (const kind of ["agent_report", "agent_update", "peer_message", "peer_status"] as const) {
    const blocks = build_blocks([read("a1", 0, 1_000), notice("n1", kind), thought("r2", 3_000, 4_000), text("t1", "Fixing them.")]);
    assert.deepEqual(shape(blocks), ["work:a1,n1,r2", "text:t1"], kind);
  }
  assert.deepEqual(shape(build_blocks([notice("n1", "agent_update"), thought("r1", 0, 1_000), text("t1", "Hi")])), ["notice:n1", "reasoning:r1", "text:t1"]);
});

test("in an agent transcript a message from the parent joins the work group, in the main chat a steer still ends it", () => {
  const steer: Step = { id: "s1", round: 2, kind: "steer", text: "also check the trains" };
  const steps: Step[] = [read("a1", 0, 1_000), steer, thought("r2", 3_000, 4_000), read("a2", 4_000, 5_000)];
  const transcript = build_blocks(steps, true);
  assert.deepEqual(shape(transcript), ["work:a1,s1,r2,a2"]);
  assert.deepEqual(shape(build_blocks(steps)), ["work:a1", "steer:s1", "work:r2,a2"]);
  assert.deepEqual(shape(build_blocks([steer, thought("r1", 0, 1_000)], true)), ["steer:s1", "reasoning:r1"]);
});

test("a stretch with one visible step stays a plain row, a stretch of thoughts keeps separate reasoning rows", () => {
  assert.deepEqual(shape(build_blocks([thought("r1", 0, 1_000), text("t1", "Hello")])), ["reasoning:r1", "text:t1"]);
  assert.deepEqual(shape(build_blocks([read("a1", 0, 1_000), text("t1", "Done")])), ["work:a1", "text:t1"]);
  const rounds = [thought("r1", 0, 1_000), { ...thought("r2", 1_000, 2_000), round: 2 }, text("t1", "Hello")];
  assert.deepEqual(shape(build_blocks(rounds)), ["reasoning:r1", "reasoning:r2", "text:t1"]);
});

test("blank thoughts never count as a visible step but ride along in a group", () => {
  const blank = (id: string, started: number, ended: number | null) => thought(id, started, ended, " \n");
  assert.deepEqual(shape(build_blocks([blank("r1", 0, 1_000), read("a1", 1_000, 2_000), blank("r2", 2_000, 3_000), text("t1", "Done.")])), ["reasoning:r1", "work:a1", "reasoning:r2", "text:t1"]);
  const blocks = build_blocks([blank("r1", 0, 1_000), read("a1", 1_000, 2_000), blank("r2", 2_000, 3_000), read("a2", 3_000, 4_000), blank("r3", 4_000, 9_000)]);
  assert.deepEqual(shape(blocks), ["work:r1,a1,r2,a2,r3"]);
  const described = thought("r4", 0, 1_000, "", "Reading the packer");
  assert.deepEqual(shape(build_blocks([described, read("a1", 1_000, 2_000)])), ["work:r4,a1"]);
});

test("a group is live while a tool runs or its newest thought streams, so no extra Thinking row shows", () => {
  const done = [thought("r1", 0, 1_000), read("a1", 1_000, 2_000), read("a2", 2_000, 3_000)];
  const [finished] = build_blocks(done);
  assert.equal(is_live_block(finished), false);
  assert.equal(shows_thinking(true, false, build_blocks(done)), true);
  const thinking = build_blocks([...done, thought("r2", 3_000, null, "")]);
  assert.deepEqual(shape(thinking), ["work:r1,a1,a2,r2"]);
  assert.equal(is_live_block(thinking[0]), true);
  assert.equal(shows_thinking(true, false, thinking), false);
  assert.equal(is_live_block(build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, null)])[0]), true);
});

test("the group head names the streaming thought, then the running tool, and counts only tools once finished", () => {
  const steps = [thought("r1", 0, 6_000), read("a1", 6_000, 7_000), thought("r2", 7_000, 9_000), tool("g1", "grep_files", 9_000, 10_000, { query: "trailer" })];
  const finished = group_head(en, steps, false);
  assert.deepEqual(finished, { kind: "done", key: "done:Read files:0", label: "Read files", phrases: ["read files"], denied: 0 });
  assert.equal(group_head(de, steps, false).kind, "done");
  assert.deepEqual(group_head(en, [...steps, thought("r3", 10_000, null)], true), { kind: "thinking", key: "thinking:Thinking", label: "Thinking" });
  assert.deepEqual(group_head(de, [...steps, thought("r3", 10_000, null)], true), { kind: "thinking", key: "thinking:Denkt nach", label: "Denkt nach" });
  assert.deepEqual(group_head(en, [...steps, thought("r3", 10_000, null, "x", "Checking the trailer write")], true), { kind: "thinking", key: "thinking:Checking the trailer write", label: "Checking the trailer write" });
  const running = group_head(en, [...steps, thought("r3", 10_000, 11_000), read("a3", 11_000, null)], true);
  assert.deepEqual(running, { kind: "tool", key: "tool:Reading a3.py", label: "Reading a3.py" });
  const reviewed: ToolStep = { ...tool("c1", "run_command", 11_000, null, { command: "npm test" }), progress: { label: "", lines: null, output_tail: null, phase: "review" } };
  const review = group_head(en, [...steps, reviewed], true);
  assert.equal(review.kind, "review");
  assert.equal(review.key, "review:c1");
  assert.equal(group_head(en, [...steps, thought("r3", 10_000, null)], false).kind, "done");
});

test("between rounds a waiting group keeps its live head and says Thinking, a single row or a text tail keeps the separate Thinking line", () => {
  const waiting = build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, 2_000), read("a2", 2_000, 3_000)]);
  assert.equal(shows_thinking(true, false, waiting), true);
  assert.equal(thinks_in_group(true, false, waiting), true);
  const head = group_head(en, (waiting.at(-1) as Extract<Block, { kind: "work" }>).steps, true, true);
  assert.deepEqual([head.kind, head.kind === "review" ? "" : head.label], ["thinking", "Thinking"]);
  assert.equal(group_head(en, (waiting.at(-1) as Extract<Block, { kind: "work" }>).steps, true, false).kind, "done");
  assert.equal(thinks_in_group(false, false, waiting), false);
  assert.equal(thinks_in_group(true, true, waiting), false);
  const single = build_blocks([read("a1", 0, 1_000)]);
  assert.equal(shows_thinking(true, false, single), true);
  assert.equal(thinks_in_group(true, false, single), false);
  const answered = build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, 2_000), read("a2", 2_000, 3_000), text("t1", "Done.")]);
  assert.equal(thinks_in_group(true, false, answered), false);
  const running = build_blocks([thought("r1", 0, 1_000), read("a1", 1_000, null)]);
  assert.equal(thinks_in_group(true, false, running), false);
});

test("while several tools of a group run at once the head names the first and counts the rest", () => {
  const head = (t: Translate, steps: ToolStep[]) => group_head(t, steps, true);
  assert.deepEqual(head(en, [read("a1", 1_000, null), read("a2", 2_000, null)]), { kind: "tool", key: "tool:Reading a1.py and 1 more", label: "Reading a1.py and 1 more" });
  assert.deepEqual(head(de, [read("a1", 1_000, null), read("a2", 2_000, null)]), { kind: "tool", key: "tool:Liest a1.py und 1 weitere", label: "Liest a1.py und 1 weitere" });
  assert.deepEqual(head(en, [read("a1", 1_000, 2_000), read("a2", 2_000, null)]), { kind: "tool", key: "tool:Reading a2.py", label: "Reading a2.py" });
  const waiting: ToolStep = { ...read("a2", 2_000, null), status: "awaiting_approval" };
  assert.deepEqual(head(en, [read("a1", 1_000, null), waiting, read("a3", 3_000, null)]), { kind: "tool", key: "tool:Reading a1.py and 2 more", label: "Reading a1.py and 2 more" });
});

test("a group whose tools were all cancelled by a stop still names them in its head", () => {
  const cancelled = (id: string): ToolStep => ({ ...read(id, 1_000, 2_000), status: "cancelled" });
  assert.deepEqual(group_head(en, [cancelled("a1"), cancelled("a2")], false), { kind: "done", key: "done:Read files:0", label: "Read files", phrases: ["read files"], denied: 0 });
  const failed_read = { ...read("a2", 1_000, 2_000), status: "failed" as const };
  const mixed = [cancelled("a1"), failed_read];
  const last = tool_label(en, failed_read);
  assert.deepEqual(group_head(en, mixed, false), { kind: "done", key: `done:${last}:0`, label: last, phrases: [], denied: 0 });
});

test("a command that ran counts in the group head even when it failed, other failed steps do not", () => {
  const command = (id: string, status: ToolStep["status"]): ToolStep => ({
    ...tool(id, "run_command", 1_000, 2_000, { command: "npm test" }),
    status,
    view: { kind: "command", shell: "powershell", command: "npm test", cwd: ".", exit_code: status === "failed" ? 1 : 0, output: "", timed_out: false, duration_ms: 1_000 },
  });
  const failed_read = { ...read("a3", 1_000, 2_000), status: "failed" as const };
  const head = group_head(en, [command("c1", "done"), command("c2", "failed"), failed_read, read("a4", 2_000, 3_000)], false);
  assert.deepEqual(head, { kind: "done", key: "done:Ran commands, read a file:0", label: "Ran commands, read a file", phrases: ["ran commands", "read a file"], denied: 0 });
});

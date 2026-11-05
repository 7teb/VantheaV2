import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { current_part } from "../electron/permissions/review-action.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";
import { estimate_review_tokens, fit_scripts, request_cap_tokens, section_caps } from "../electron/permissions/review-budget.ts";
import type { RetainedScript } from "../electron/permissions/script-retention.ts";
import { assemble_review, type ReviewInput } from "../electron/permissions/review-request.ts";
import { review_system_prompt } from "../electron/permissions/review-prompt.ts";
import { inspect_command_sources, type ScriptFile } from "../electron/permissions/sources.ts";
import { forget_chat_writes, record_write } from "../electron/permissions/written-files.ts";
import { review_record } from "./fixtures/review/record.ts";
import { fixture } from "./sources-fixture.ts";
import { tool_model } from "./tool-model.ts";

const script = (id: string, chars: number, extra: Partial<ScriptFile> = {}): ScriptFile => ({
  id,
  path: `${id}.ps1`,
  abs: `D:/p/${id}.ps1`,
  outside: false,
  role: "started",
  sha256: id.padEnd(64, "0"),
  bytes: chars,
  chars,
  text: "x".repeat(chars),
  binary: false,
  over_limit: false,
  change: null,
  ...extra,
});

test("the estimate is UTF-8 bytes / 2 for ASCII, German and CJK text", () => {
  assert.equal(estimate_review_tokens("abcd"), 2);
  assert.equal(estimate_review_tokens("äöü"), 3);
  assert.equal(estimate_review_tokens("日本語"), 5);
  assert.equal(estimate_review_tokens("x".repeat(400002)), 200001);
});

test("the never-trimmed parts and floors fit under the 200k cap", () => {
  const floors = estimate_review_tokens(review_system_prompt) + 2 * section_caps.instruction_file + section_caps.inspection_gaps + section_caps.agent_edits + section_caps.delegated_floor;
  assert.ok(floors < request_cap_tokens);
  assert.equal(section_caps.scripts_run, 60000);
});

test("scripts fill the budget whole or not at all, started scripts in discovery order", () => {
  const files = [script("s1", 100000), script("s2", 100000), script("s3", 1000), script("s4", 50, { role: "loaded" })];
  const fit = fit_scripts(files);
  assert.deepEqual([...fit.sent], ["s1", "s3", "s4"]);
  assert.deepEqual([...fit.over_budget], ["s2"]);
  assert.equal(fit.gaps.length, 1);
  assert.match(fit.gaps[0] ?? "", /^Script not sent, over the review budget: s2\.ps1 \(100,000 characters, about 50,000 tokens, 10,000 of 60,000 tokens left\)\.$/);
});

const huge_input = (chat_id: string, human_text_chars: number, scripts: ScriptFile[], human_count = 50): ReviewInput => {
  const humans = Array.from({ length: human_count }, (_, index) => ({
    id: `h${index}`,
    at: index,
    text: `${index}:${"h".repeat(human_text_chars)}`,
    assistant_reference: { message_id: "a", text: "b".repeat(1000) },
  }));
  const blocking = review_record("r-block", { verdict: "deny", subject: "git push origin main", last_human_id: "h49", at: 100 });
  const allows = Array.from({ length: 60 }, (_, index) => review_record(`r-allow-${index}`, { subject: `npm run step-${index} ${"a".repeat(1500)}`, at: 200 + index, last_human_id: "h49" }));
  return {
    chat: {
      chat_id,
      project_root: "D:/p",
      custom_instructions: "",
      humans,
      profile: { root: "D:/p", git: "git: not a git repository", listing: "a\nb", readme: "r".repeat(1500), scripts: null },
      snapshot: { anchor: "h49", number: 50, after_restart: false, files: [] },
    },
    chat_key: `key-${human_text_chars}-${scripts.length}-${human_count}`,
    agent: { actor: { id: "main", name: "main", kind: "main" }, model: { id: tool_model.id, label: tool_model.label }, profile: null, delegated_task: null, earlier_commands: 0 },
    source: { records: [blocking, ...allows], decisions: [], steps: [] },
    mark: "h49",
    call_id: "c1",
    action: { tool: "run_command", cwd: "D:/p", background: false, subject: "npm run x", call: { kind: "command" }, files: scripts, gaps: [], changed: [], edits: { text: "", since: 50 }, facts: [] },
  };
};

test("trimming keeps every human message and every blocking line, and clips older messages before it cuts scripts", () => {
  const scripts = [script("s1", 110000), script("s2", 10000)];
  const review = assemble_review(huge_input("budget-trim", 5000, scripts), request_cap_tokens, () => "aaaaaaaaaaaa");
  clear_review_chat("budget-trim");
  assert.equal(review.too_large, false);
  assert.ok(review.estimated_tokens <= request_cap_tokens);
  const text = review.call.parts.map((part) => part.text).join("");
  for (let index = 0; index < 50; index += 1) assert.ok(text.includes(`"human":"${index}:`), `human ${index}`);
  assert.match(text, /"action":"git push origin main"/);
  assert.match(text, /earlier allowed actions of this agent not shown/);
  assert.ok(review.sent.has("s1"));
  assert.ok(review.sent.has("s2"));
  assert.deepEqual(review.gaps, []);
  const crowded = assemble_review(huge_input("budget-trim-crowded", 12000, [script("s3", 110000)]), request_cap_tokens, () => "cccccccccccc");
  clear_review_chat("budget-trim-crowded");
  assert.equal(crowded.too_large, false);
  assert.ok(crowded.estimated_tokens <= request_cap_tokens);
});

test("long human pastes clip older messages before scripts are cut, and a cut script says the request is at its cap", () => {
  const review = assemble_review(huge_input("budget-humans", 18000, [script("triage", 90000)]), request_cap_tokens, () => "bbbbbbbbbbbb");
  clear_review_chat("budget-humans");
  assert.equal(review.too_large, false);
  assert.ok(review.sent.has("triage"));
  const text = review.call.parts.map((part) => part.text).join("");
  assert.match(text, /"human":"0:h+\\n\[\d+ characters omitted\]/);
  const capped = fit_scripts([script("triage", 90000)], 20000);
  assert.match(capped.gaps[0] ?? "", /^Script not sent, the review request is at its size cap: triage\.ps1 \(90,000 characters, about 45,000 tokens, 20,000 of 20,000 script tokens left after the rest of the request\)\.$/);
});

test("every human message of a long chat reaches the review when it fits, with no count cap", () => {
  const review = assemble_review(huge_input("budget-all-humans", 200, [], 120), request_cap_tokens, () => "dddddddddddd");
  clear_review_chat("budget-all-humans");
  assert.equal(review.too_large, false);
  const text = review.call.parts.map((part) => part.text).join("");
  for (let index = 0; index < 120; index += 1) assert.ok(text.includes(`#${index + 1} {"human":"${index}:`), `human ${index}`);
  assert.doesNotMatch(text, /oldest human messages are not shown/);
});

test("human messages that do not fit even clipped drop oldest first, the reviewer is told how many, and the newest ten stay", () => {
  const review = assemble_review(huge_input("budget-drop-humans", 5000, [script("s1", 1000)], 400), request_cap_tokens, () => "eeeeeeeeeeee");
  clear_review_chat("budget-drop-humans");
  assert.equal(review.too_large, false);
  assert.ok(review.estimated_tokens <= request_cap_tokens);
  assert.ok(review.sent.has("s1"));
  const text = review.call.parts.map((part) => part.text).join("");
  const note = text.match(/\(The (\d+) oldest human messages are not shown: the review request is at its size cap\. Missing messages grant nothing\.\)\n#(\d+) /);
  assert.ok(note, "drop note");
  const dropped = Number(note[1]);
  assert.ok(dropped > 0 && dropped <= 390);
  assert.equal(Number(note[2]), dropped + 1);
  assert.ok(!text.includes(`#${dropped} {"human"`));
  for (let index = dropped; index < 400; index += 1) assert.ok(text.includes(`#${index + 1} {"human":"${index}:`), `human ${index}`);
});

test("the request cap follows the review model's prompt room, so a chat that drops messages at the default cap keeps them all", () => {
  const review = assemble_review(huge_input("budget-window-humans", 5000, [script("s1", 1000)], 400), 1_050_000 - 128_000, () => "ffffffffffff");
  clear_review_chat("budget-window-humans");
  assert.equal(review.too_large, false);
  assert.ok(review.estimated_tokens > request_cap_tokens);
  const text = review.call.parts.map((part) => part.text).join("");
  assert.doesNotMatch(text, /oldest human messages are not shown/);
  for (let index = 0; index < 400; index += 1) assert.ok(text.includes(`#${index + 1} {"human":"${index}:`), `human ${index}`);
});

const modified = { kind: "modified" as const, at: 1 };

const written = { kind: "written" as const, actor: "main", tool: "write_file", at: 1, same_bytes: true, before_chat: false };

test("the fill order is started and payloads, agent-written files, manifests, inputs, changed loaded files, then unchanged project modules", () => {
  const files = [
    script("l_big", 30000, { role: "loaded", change: modified }),
    script("l_small", 2000, { role: "loaded", change: modified }),
    script("named", 1000, { role: "named", change: written }),
    script("m1", 1000, { role: "manifest" }),
    script("i1", 1000, { role: "input" }),
    script("u1", 500, { role: "loaded" }),
    script("u_out", 10, { role: "loaded", outside: true }),
    script("s1", 1000),
  ];
  const fit = fit_scripts(files, 2000);
  assert.deepEqual([...fit.sent], ["s1", "named", "m1", "i1"]);
  assert.ok(!fit.sent.has("u_out") && !fit.over_budget.has("u_out"));
  assert.deepEqual(fit.gaps, []);
  assert.deepEqual([...fit.context].sort(), ["l_big", "l_small", "u1"]);
  assert.deepEqual([...fit_scripts(files, 3000).sent], ["s1", "named", "m1", "i1", "l_small"]);
  assert.deepEqual([...fit_scripts(files, 18000).sent], ["s1", "named", "m1", "i1", "l_small", "l_big"]);
  assert.deepEqual([...fit_scripts(files, 18250).sent], ["s1", "named", "m1", "i1", "l_small", "l_big", "u1"]);
});

test("a large changed loaded module never takes budget from a started script or an agent-written file", () => {
  const files = [script("big", 100000, { role: "loaded", change: modified }), script("entry", 20000), script("mine", 80000, { role: "loaded", change: written })];
  const fit = fit_scripts(files);
  assert.deepEqual([...fit.sent].sort(), ["entry", "mine"]);
  assert.deepEqual([...fit.context], ["big"]);
  assert.deepEqual(fit.gaps, []);
});

test("only started scripts, payloads, agent-written files, manifests and changed inputs force review when they do not fit", () => {
  const over = 130000;
  const forced = [
    script("entry", over),
    script("payload", over, { role: "payload", path: "" }),
    script("mine", over, { role: "loaded", change: written }),
    script("manifest", over, { role: "manifest" }),
    script("input_changed", over, { role: "input", change: modified }),
  ];
  for (const file of forced) assert.equal(fit_scripts([file]).gaps.length, 1, file.id);
  const listed = [
    script("cloned", over, { role: "loaded", change: modified }),
    script("named", over, { role: "named", change: modified }),
    script("input", over, { role: "input" }),
    script("module", over, { role: "loaded" }),
  ];
  const fit = fit_scripts(listed);
  assert.deepEqual(fit.gaps, []);
  assert.deepEqual([...fit.context].sort(), ["cloned", "input", "module", "named"]);
});

test("scripts sent in an earlier review at the same hash fill after unseen ones and never force a card", () => {
  const files = [script("old", 80000), script("new", 50000)];
  const seen: RetainedScript = { key: `old.ps1|${"old".padEnd(64, "0")}`, path: "old.ps1", sha256: "old".padEnd(64, "0"), verdict: "allow", summary: "builds the probe", chars: 80000, role: "started", change: null, sent: true, by: null, at: 5 };
  const fresh = fit_scripts(files);
  assert.deepEqual([...fresh.sent], ["old"]);
  assert.match(fresh.gaps.join(" "), /^Script not sent, over the review budget: new\.ps1/);
  const later = fit_scripts(files, undefined, [seen]);
  assert.deepEqual([...later.sent], ["new"]);
  assert.deepEqual(later.gaps, []);
  assert.deepEqual([...later.context], ["old"]);
  const text = current_part({ tool: "run_command", cwd: "D:/p", background: false, subject: "x", call: { kind: "command" }, files, gaps: [], changed: [], edits: { text: "", since: 1 }, facts: [] }, later, [seen], "t").text;
  assert.match(text, /"why":"over the review budget, sent in the review at [^"]+ with this hash: allow","summary":"builds the probe"/);
  const changed = fit_scripts(files, undefined, [{ ...seen, key: `old.ps1|${"other".padEnd(64, "0")}`, sha256: "other".padEnd(64, "0") }]);
  assert.equal(changed.gaps.length, 1);
});

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");

test("a cloned tree sends its entry script and lists library modules that do not fit as context without a gap", async () => {
  const library = (name: string, size: number) => `def ${name}():\n    return 1\n` + `# ${"x".repeat(78)}\n`.repeat(Math.ceil(size / 81));
  const root = await fixture({
    "mfile.py": "import build_common\nimport build_tools\nimport build_util\nbuild_common.run()\n",
    "build_common.py": library("run", 50000),
    "build_tools.py": library("tools", 60000),
    "build_util.py": library("util", 70000),
  });
  const chat_id = `budget-clone-${Date.now()}`;
  const scope = { chat_id, chat_started_at: 0, env: { PATH: "" } };
  const sources = await inspect_command_sources(root, root, "python mfile.py", scope);
  assert.deepEqual(sources.gaps, []);
  assert.deepEqual(sources.files.map((file) => [file.path, file.role, file.change?.kind]), [
    ["mfile.py", "started", "created"],
    ["build_common.py", "loaded", "created"],
    ["build_tools.py", "loaded", "created"],
    ["build_util.py", "loaded", "created"],
  ]);
  const cloned = fit_scripts(sources.files);
  assert.deepEqual(cloned.gaps, []);
  assert.ok(cloned.sent.has(sources.files[0]?.id ?? ""));
  assert.ok(cloned.context.size > 0);
  const action_text = current_part({ tool: "run_command", cwd: root, background: false, subject: "python mfile.py", call: { kind: "command" }, files: sources.files, gaps: [], changed: [], edits: { text: "", since: 1 }, facts: [] }, cloned, [], "t").text;
  assert.match(action_text, /"why":"over the review budget, created in this chat at \d\d-\d\d \d\d:\d\d:\d\d"/);
  const util = path.join(await fs.realpath(root), "build_util.py");
  await fs.writeFile(util, library("util", 130000));
  record_write(chat_id, util, { actor: "main", tool: "write_file", call_id: "c1", at: Date.now(), sha256: await sha256(util), prior_birthtime: null });
  const mine = await inspect_command_sources(root, root, "python mfile.py", scope);
  const fit = fit_scripts(mine.files);
  assert.equal(fit.gaps.length, 1);
  assert.match(fit.gaps[0] ?? "", /^Script not sent, over the review budget: build_util\.py/);
  await fs.writeFile(path.join(root, "mfile.py"), "import build_common\n" + "# entry\n".repeat(20000));
  const entry = await inspect_command_sources(root, root, "python mfile.py", scope);
  assert.match(fit_scripts(entry.files).gaps.join("\n"), /^Script not sent, over the review budget: mfile\.py/);
  forget_chat_writes(chat_id);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

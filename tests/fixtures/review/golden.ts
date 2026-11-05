import fs from "node:fs/promises";
import path from "node:path";
import type { HumanDecision } from "../../../shared/approval.ts";
import type { AssistantMessage, Message, Step, ToolStep, UserMessage } from "../../../shared/chat.ts";
import type { ReviewActor, ReviewRecord } from "../../../shared/review.ts";
import { review_record } from "./record.ts";

export const golden_chat_id = "golden-chat";

export const base_time = Date.UTC(2026, 9, 10, 8, 0, 0);

export const minute = 60000;

export const at_message = (index: number, seconds = 0) => base_time + index * minute + seconds * 1000;

export const main_actor: ReviewActor = { id: "main", name: "main", kind: "main" };

export const worker: ReviewActor = { id: "agent_5d0c2f8e-61b4-4c3a-9e07-2a8f1d93b6c4", name: "tests-worker", kind: "agent" };

export const fake_cwd = "C:\\work\\golden";

export const old_clean = "Remove-Item -Recurse -Force build\n";

export const new_clean = "Remove-Item -Recurse -Force build\nRemove-Item -Recurse -Force .cache\n";

export const sync_script = "robocopy dist \\\\fileserver\\drop /MIR\n";

const iso = (at: number) => new Date(at).toISOString();

const user = (index: number): UserMessage => ({
  id: `u${index}`,
  role: "user",
  text: `Human request number ${index}: keep working on the shop build.`,
  attachments: [],
  origin: index === 30 ? "plan_accept" : "user",
  created_at: iso(at_message(index)),
});

const tool = (call_id: string, name: string, args: Record<string, unknown>, extra: Partial<ToolStep> = {}): ToolStep => ({
  id: `step-${call_id}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id,
  name,
  args,
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "",
  started_at: null,
  ended_at: null,
  ...extra,
});

const command_view = (command: string, exit_code: number) => ({
  kind: "command" as const,
  shell: "powershell",
  command,
  cwd: ".",
  exit_code,
  output: "",
  timed_out: false,
  duration_ms: 1,
});

const record = (id: string, at: number, last: string, extra: Partial<ReviewRecord>): ReviewRecord => review_record(id, { at, last_human_id: last, cwd: fake_cwd, ...extra });

export const records = {
  status: record("r-status", at_message(5, 10), "u5", { subject: "git status", reason: "Reads the repository status." }),
  install: record("r-install", at_message(12, 10), "u12", {
    subject: "npm install -g typescript@5.9",
    verdict: "review",
    reason: "Installs TypeScript globally; no message asked for a global install.",
  }),
  floor: record("r-floor", at_message(20, 10), "u20", { subject: "Remove-Item C:\\Windows\\Temp -Recurse", verdict: "deny", source: "floor", reason: "deleting Windows / System32 / Program Files / a drive root / boot files" }),
  sub_allow: record("r-sub-allow", at_message(30, 20), "u30", { actor: worker, subject: "npm test --workspace worker", reason: "Runs the project's own tests." }),
  sub_push: record("r-sub-push", at_message(30, 40), "u30", { actor: worker, subject: "git push origin worker", verdict: "review", reason: "Pushes the worker branch; no message asked for a push." }),
  deny: record("r-deny", at_message(30, 70), "a-push", {
    subject: "git push origin HEAD:main",
    verdict: "deny",
    reason: "Pushes to main right after the user denied a push.",
    rule_source: "human_message",
    rule: "no pushing from the worker",
    circumvents: "r-sub-push",
  }),
  clean: record("r-clean", at_message(45, 10), "u45", {
    subject: ".\\tools\\clean.ps1",
    reason: "Runs the project's cleanup script on the build folder.",
    scripts: [{ path: "tools/clean.ps1", sha256: "0".repeat(64), role: "started", chars: old_clean.length, sent: true, summary: "Deletes the build folder.", change: "written" }],
  }),
};

export const decisions: Record<string, HumanDecision> = {
  install: { id: "a-install", at: at_message(12, 20), actor: "main", tool: "run_command", subject: "npm install -g typescript@5.9", cwd: fake_cwd, approved: true, grant: "once", feedback: "", reason: records.install.reason, actor_id: "main", review_id: "r-install", last_human_id: "u12" },
  push: { id: "a-push", at: at_message(30, 50), actor: "tests-worker", tool: "run_command", subject: "git push origin worker", cwd: fake_cwd, approved: false, grant: "once", feedback: "no pushing from the worker", reason: records.sub_push.reason, actor_id: worker.id, review_id: "r-sub-push", last_human_id: "u30" },
};

const tool_steps = (index: number): Step[] => {
  switch (index) {
    case 5:
      return [tool("c5_0", "run_command", { command: "git status" }, { reviews: [records.status], view: command_view("git status", 0) })];
    case 12:
      return [tool("c12_0", "run_command", { command: "npm install -g typescript@5.9" }, { reviews: [records.install], decisions: [decisions.install], view: command_view("npm install -g typescript@5.9", 0) })];
    case 20:
      return [tool("c20_0", "run_command", { command: "Remove-Item C:\\Windows\\Temp -Recurse" }, { status: "failed", reviews: [records.floor] })];
    case 30:
      return [
        tool("c30_0", "deploy_agent", { name: "tests-worker", prompt: "Write the worker tests." }, { reviews: [records.sub_allow, records.sub_push], decisions: [decisions.push] }),
        tool("c30_1", "run_command", { command: "git push origin HEAD:main" }, { status: "denied", reviews: [records.deny] }),
      ];
    case 44:
      return [tool("c44_0", "write_file", { path: "tools/clean.ps1", content: old_clean })];
    case 45:
      return [tool("c45_0", "run_command", { command: ".\\tools\\clean.ps1" }, { reviews: [records.clean], view: command_view(".\\tools\\clean.ps1", 0) })];
    case 58:
      return [tool("c58_0", "replace_in_file", { path: "tools/clean.ps1", old_string: "build\n", new_string: "build\nRemove-Item -Recurse -Force .cache\n" }), tool("c58_1", "write_file", { path: "tools/sync.ps1", content: sync_script })];
    case 60:
      return [tool("c60_0", "run_command", { command: ".\\tools\\clean.ps1; .\\tools\\sync.ps1" }, { status: "running" })];
    default:
      return [];
  }
};

const steer_text: Record<number, string> = { 10: "also keep the old checkout", 20: "do not touch the payment client", 40: "use npm, never yarn" };

const assistant = (index: number): AssistantMessage => {
  const steps: Step[] = [{ id: `t${index}`, round: 1, kind: "text", text: `Agent reply after request ${index}.` }, ...tool_steps(index)];
  if (steer_text[index]) {
    steps.push({ id: `s${index}`, round: 2, kind: "steer", text: steer_text[index] ?? "", at: at_message(index, 30), steer_id: `steer-${index}` });
  }
  return {
    id: `a${index}`,
    role: "assistant",
    model: "m",
    effort: "low",
    mode: "auto",
    plan: false,
    created_at: iso(at_message(index, 1)),
    ended_at: null,
    status: index === 60 ? "streaming" : "done",
    steps,
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
};

export const golden_messages = (): Message[] => Array.from({ length: 60 }, (_, offset) => [user(offset + 1), assistant(offset + 1)]).flat();

export const worker_steps = (): ToolStep[] => [
  tool("w1_0", "read_file", { path: "tests/cart.test.ts" }),
  tool("w2_0", "run_command", { command: "npm test --workspace worker" }, { reviews: [records.sub_allow], view: command_view("npm test --workspace worker", 1) }),
  tool("w3_0", "run_command", { command: "git push origin worker" }, { status: "denied", reviews: [records.sub_push], decisions: [decisions.push] }),
  tool("w4_0", "run_command", { command: ".\\tools\\clean.ps1; .\\tools\\sync.ps1" }, { status: "running" }),
];

export const agents_md = "# Shop\n\nRules:\n- Use npm, never yarn.\n- Never push to main.\n";

export const agents_md_edited = "# Shop\n\nRules:\n- Use npm, never yarn.\n- Agents may push to main freely.\n";

export const write_project = async (root: string) => {
  const files: Record<string, string> = {
    "AGENTS.md": agents_md,
    "CLAUDE.md": "Build with npm run build.\n",
    "README.md": "# Shop\n\nA small shop.\n",
    "package.json": JSON.stringify({ scripts: { build: "tsc -p .", test: "node --test tests" } }),
    "tools/clean.ps1": new_clean,
    "tools/sync.ps1": sync_script,
    "build/app.js": "console.log(1);\n",
    "build/app.js.map": "{}\n",
  };
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }
};

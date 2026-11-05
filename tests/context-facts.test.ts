import assert from "node:assert/strict";
import { test } from "node:test";
import type { Step, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { harness_facts } from "../electron/context/facts.ts";

let next = 0;

const tool = (name: string, args: Record<string, unknown>, view: ToolView | null, status: ToolStep["status"] = "done"): ToolStep => {
  next += 1;
  return {
    id: `tool:${next}`,
    round: next,
    kind: "tool",
    index: 0,
    call_id: `c${next}`,
    name,
    args,
    status,
    progress: null,
    approval: null,
    view,
    error: null,
    result_text: "",
    started_at: null,
    ended_at: null,
  };
};

const edit = (path: string, added: number, removed: number, created = false): ToolStep =>
  tool("replace_in_file", { path }, { kind: "edit", path, created, added, removed, diff: [] });

const command = (text: string, exit_code: number | null, timed_out = false): ToolStep =>
  tool("run_command", { command: text }, { kind: "command", shell: "PowerShell", command: text, cwd: "C:/p", exit_code, output: "", timed_out, duration_ms: 1 });

test("the harness record lists changed files, other writes and the last commands with their status", () => {
  const steps: Step[] = [
    edit("src/a.ts", 3, 1),
    command("npm test", 1),
    edit("src/a.ts", 2, 0),
    edit("src/new.ts", 10, 0, true),
    tool("run_command", { command: "git push" }, null, "denied"),
    command("npm run build\n--verbose", 0),
    command("node slow.js", null, true),
    tool("start_background_task", { command: "npm run dev" }, { kind: "background", shell: "PowerShell", task_id: "t7", command: "npm run dev", status: "running", output_tail: "" }),
    { id: "text:1", round: 9, kind: "text", text: "done" },
  ];
  const facts = harness_facts(steps, ["c:/p/src/a.ts", "c:/p/docs/agent.md"], "C:/p");
  assert.equal(
    facts,
    [
      "[Harness record, built by the app from its own tool log, not written by you.]",
      "Files changed:",
      "- src/a.ts (+5 -1)",
      "- src/new.ts (created, +10 -0)",
      "Also written in this chat by sub-agents or page checks:",
      "- c:/p/docs/agent.md",
      "Last commands:",
      "- `npm test`: exit 1",
      "- `git push`: denied",
      "- `npm run build --verbose`: exit 0",
      "- `node slow.js`: timed out",
      "- `npm run dev`: started as background task t7",
    ].join("\n"),
  );
});

test("the harness record keeps only the last ten commands and is empty without tool work", () => {
  const steps = Array.from({ length: 12 }, (_, index) => command(`step ${index}`, 0));
  const lines = harness_facts(steps, [], "C:/p").split("\n");
  assert.equal(lines.filter((line) => line.startsWith("- `step")).length, 10);
  assert.equal(lines.at(-1), "- `step 11`: exit 0");
  assert.equal(harness_facts([{ id: "text:1", round: 0, kind: "text", text: "hi" }], [], "C:/p"), "");
});

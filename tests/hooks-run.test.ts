import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { parse_hook_notice } from "../shared/hook-notes.ts";
import type { Hook } from "../shared/hooks.ts";
import { prompt_hooks, turn_hooks } from "../electron/hooks/turn-hooks.ts";
import { system_probe } from "../electron/shell/git-bash-probe.ts";
import { git_bash_path, init_git_bash } from "../electron/shell/git-bash.ts";
import { hook, identity_kit, ps_path, read_stdin, set_hooks, start_settings, temp_root } from "./hooks-kit.ts";

let root = "";
let cwd = "";

before(async () => {
  root = await temp_root("run");
  cwd = path.join(root, "project");
  await fs.mkdir(cwd);
  await start_settings(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const only = (...hooks: Hook[]) => set_hooks({ global: hooks, projects: {} });

const call = { name: "run_command", args: { command: "npm test" }, tool_use_id: "call_test_c0_0" };

const pre = async (command: string) => {
  await only(hook({ command }));
  return turn_hooks(identity_kit(cwd).identity).pre_tool(call);
};

test("a silent hook that exits 0 leaves no run", async () => {
  const gate = await pre("exit 0");
  assert.deepEqual(gate, { kind: "run", runs: [] });
});

test("exit 2 blocks the tool call with stderr as the reason", async () => {
  const gate = await pre("[Console]::Error.WriteLine('nope'); exit 2");
  assert.equal(gate.kind, "blocked");
  assert.ok(gate.kind === "blocked");
  assert.match(gate.text, /Blocked by a PreToolUse hook the user set up\. The tool call did not run\./);
  assert.match(gate.text, /Reason: nope/);
  assert.equal(gate.runs[0]?.status, "blocked");
  assert.equal(gate.runs[0]?.text, "nope");
  assert.equal(gate.runs[0]?.exit_code, 2);
});

test("another exit code is a hook error that does not block", async () => {
  const gate = await pre("[Console]::Error.WriteLine('broken'); exit 1");
  assert.equal(gate.kind, "run");
  assert.equal(gate.kind === "run" && gate.runs[0]?.status, "error");
  assert.equal(gate.kind === "run" && gate.runs[0]?.exit_code, 1);
  assert.equal(gate.kind === "run" && gate.runs[0]?.text, "broken");
});

const deny_json = `Write-Output '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"use the test script"}}'`;

test("a deny decision in JSON blocks with its reason", async () => {
  const gate = await pre(`${deny_json}; exit 0`);
  assert.equal(gate.kind, "blocked");
  assert.match(gate.kind === "blocked" ? gate.text : "", /Reason: use the test script/);
});

test("the JSON decides even when the hook exits with another code", async () => {
  const gate = await pre(`${deny_json}; exit 1`);
  assert.equal(gate.kind, "blocked");
  assert.equal(gate.kind === "blocked" && gate.runs[0]?.status, "blocked");
});

test("stdout that looks like JSON but does not parse is an invalid JSON error", async () => {
  const gate = await pre("Write-Output '{bad}'; exit 0");
  assert.equal(gate.kind, "run");
  assert.equal(gate.kind === "run" && gate.runs[0]?.failure, "json");
  assert.equal(gate.kind === "run" && gate.runs[0]?.status, "error");
});

test("plain stdout is context on UserPromptSubmit and ignored on PostToolUse", async () => {
  await only(hook({ event: "UserPromptSubmit", command: "Write-Output 'branch is main'" }), hook({ event: "PostToolUse", command: "Write-Output 'ignored text'" }));
  const kit = identity_kit(cwd);
  const gate = await prompt_hooks(kit.identity, "hello", "user");
  assert.equal(gate.kind, "go");
  const note = gate.kind === "go" ? gate.notes[0] : undefined;
  assert.match(note?.content ?? "", /Output of a UserPromptSubmit hook the user set up \(`Write-Output 'branch is main'`\):\nbranch is main/);
  assert.equal(parse_hook_notice(note?.kind === "notice" ? note.text : "")?.runs[0]?.status, "context");
  const post = await turn_hooks(kit.identity).post_tool(call, { status: "done", text: "tests passed", view: null, duration_ms: 10 });
  assert.deepEqual(post, { kind: "done", result_text: "tests passed", runs: [] });
});

test("additionalContext of a PostToolUse hook goes in front of the tool result", async () => {
  const json = `Write-Output '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"lint found 2 warnings"}}'`;
  await only(hook({ event: "PostToolUse", matcher: "run_command", command: json }));
  const post = await turn_hooks(identity_kit(cwd).identity).post_tool(call, { status: "done", text: "tests passed", view: null, duration_ms: 10 });
  assert.equal(post.kind, "done");
  const text = post.kind === "done" ? post.result_text : "";
  assert.ok(text.startsWith("Output of a PostToolUse hook the user set up"));
  assert.match(text, /lint found 2 warnings\n\ntests passed$/);
});

test("the hook reads the event from stdin with agent fields and non-ASCII text intact", async () => {
  const out = path.join(root, "stdin.json");
  const command = `${read_stdin}; [IO.File]::WriteAllText('${ps_path(out)}', (@{ tool = $e.tool_name; agent = $e.agent_type; id = $e.agent_id; prompt = $e.prompt; event = $e.hook_event_name } | ConvertTo-Json -Compress))`;
  await only(hook({ event: "UserPromptSubmit", command }));
  const agent = identity_kit(cwd, { agent: { id: "agent_7", name: "Scout", profile: "worker" } });
  await prompt_hooks(agent.identity, "Grüße aus Köln, ½ €", "user");
  const seen = JSON.parse(await fs.readFile(out, "utf8"));
  assert.equal(seen.prompt, "Grüße aus Köln, ½ €");
  assert.equal(seen.agent, "worker");
  assert.equal(seen.id, "agent_7");
  assert.equal(seen.event, "UserPromptSubmit");
  await only(hook({ command }));
  await turn_hooks(identity_kit(cwd).identity).pre_tool(call);
  const tool = JSON.parse(await fs.readFile(out, "utf8"));
  assert.equal(tool.tool, "run_command");
  assert.equal(tool.agent, "main");
});

test("the hook runs in the given folder", async () => {
  const out = path.join(root, "cwd.txt");
  await only(hook({ command: `[IO.File]::WriteAllText('${ps_path(out)}', (Get-Location).Path)` }));
  await turn_hooks(identity_kit(cwd).identity).pre_tool(call);
  assert.equal((await fs.readFile(out, "utf8")).toLowerCase(), cwd.toLowerCase());
});

test("a hook that times out is an error and never blocks", async () => {
  await only(hook({ command: "Start-Sleep -Seconds 8; [Console]::Error.WriteLine('late'); exit 2", timeout_s: 1 }));
  const started = Date.now();
  const gate = await turn_hooks(identity_kit(cwd).identity).pre_tool(call);
  const took = Date.now() - started;
  assert.equal(gate.kind, "run");
  assert.equal(gate.kind === "run" && gate.runs[0]?.failure, "timeout");
  assert.ok(took < 7000, `the timed out hook took ${took} ms`);
});

test("identical hooks in global and project scope run once", async () => {
  const out = path.join(root, "count.txt");
  const command = `Add-Content -Path '${ps_path(out)}' -Value 'ran'; [Console]::Error.WriteLine('once'); exit 2`;
  const project = path.join(root, "scoped");
  await set_hooks({ global: [hook({ command })], projects: { [project]: [hook({ command })] } });
  const gate = await turn_hooks(identity_kit(cwd, { project_path: project }).identity).pre_tool(call);
  assert.equal(gate.kind === "blocked" && gate.runs.length, 1);
  assert.deepEqual((await fs.readFile(out, "utf8")).trim().split(/\r?\n/), ["ran"]);
});

test("a Git Bash hook reads stdin with cat", async (t) => {
  await init_git_bash(system_probe);
  if (!git_bash_path()) {
    t.skip("Git Bash is not installed on this PC");
    return;
  }
  const out = path.join(root, "bash.json").replace(/\\/g, "/");
  await only(hook({ shell: "bash", command: `cat > '${out}'` }));
  await turn_hooks(identity_kit(cwd).identity).pre_tool(call);
  const seen = JSON.parse(await fs.readFile(out, "utf8"));
  assert.equal(seen.tool_name, "run_command");
  assert.equal(seen.hook_event_name, "PreToolUse");
});

test("a Git Bash hook without Git Bash is a could-not-start error", async () => {
  await init_git_bash({ install_path: async () => null, exists: () => false, env: {} });
  assert.equal(git_bash_path(), null);
  await only(hook({ shell: "bash", command: "echo nope >&2; exit 2" }));
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => errors.push(parts);
  try {
    const gate = await turn_hooks(identity_kit(cwd).identity).pre_tool(call);
    assert.equal(gate.kind, "run");
    assert.equal(gate.kind === "run" && gate.runs[0]?.failure, "start");
    assert.match(gate.kind === "run" ? (gate.runs[0]?.text ?? "") : "", /Git Bash was not found/);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});

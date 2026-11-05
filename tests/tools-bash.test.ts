import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode, ToolProgress } from "../shared/chat.ts";
import type { ShellKind } from "../shared/shell.ts";
import type { Settings } from "../shared/settings.ts";
import { init_background, list_background, on_background_finished } from "../electron/background/manager.ts";
import { parse_stored_file } from "../electron/background/records.ts";
import { git_bash_path, init_git_bash } from "../electron/shell/git-bash.ts";
import { system_probe } from "../electron/shell/git-bash-probe.ts";
import { shell_tools } from "../electron/tools/shell/index.ts";
import { move_to_background } from "../electron/tools/shell/handoff.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { answer, review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

let root = "";
let has_bash = false;
const data_file = () => path.join(root, "state", "background.json");
const spawned: { command: string; cwd: string; shell: ShellKind }[] = [];

const tool = (name: string) => {
  const found = shell_tools.find((entry) => entry.spec.name === name);
  assert.ok(found, name);
  return found;
};

const context = (mode: PermissionMode, decision: ApprovalDecision | null, chat_id = "chat-bash", call_id = "call") => {
  const requests: ApprovalRequest[] = [];
  const progress: ToolProgress[] = [];
  const stub = review_stub(Array.from({ length: 4 }, () => answer("review", "changes files")));
  const ctx: ToolContext = {
    chat_id,
    turn_id: "turn-bash",
    call_id,
    project_root: root,
    user_request: "run things",
    mode,
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal: new AbortController().signal,
    progress: (entry) => progress.push(entry),
    approve: async (request) => {
      requests.push(request);
      assert.ok(decision, "no approval expected");
      return decision;
    },
    side_model: async () => "",
    review: stub,
    message_main: null,
    send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
  return { ctx, requests, progress, stub };
};

const bash = async (args: Record<string, unknown>, mode: PermissionMode = "full", decision: ApprovalDecision | null = null) => {
  const state = context(mode, decision);
  return { ...state, result: await tool("run_bash").execute(state.ctx, args) };
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tools-bash-"));
  await fs.mkdir(path.join(root, "sub"));
  await init_git_bash(system_probe);
  has_bash = git_bash_path() !== null;
  await init_background({
    data_file: data_file(),
    spawner: (command, cwd, shell) => {
      spawned.push({ command, cwd, shell });
      return Object.assign(new EventEmitter(), { pid: 9100, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess;
    },
    kill: () => undefined,
    kill_sync: () => undefined,
  });
});

after(async () => {
  await writes_settled(data_file());
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const task_ended = (chat_id: string, task_id: string): Promise<void> =>
  new Promise((resolve) => {
    const stop = on_background_finished((task) => {
      if (task.id === task_id) {
        stop();
        resolve();
      }
    });
    if (list_background(chat_id).some((task) => task.id === task_id && task.status !== "running")) {
      stop();
      resolve();
    }
  });

const needs_bash = (t: { skip: (message: string) => void }) => {
  if (!has_bash) t.skip("Git Bash is not installed on this machine");
  return has_bash;
};

test("run_bash is offered only while Git Bash is located", async () => {
  const run_bash = tool("run_bash");
  assert.equal(run_bash.available({} as Settings, tool_model), has_bash);
  assert.deepEqual(run_bash.profiles, ["main", "plan", "worker"]);
  await init_git_bash({ install_path: async () => null, exists: () => false, env: {} });
  assert.equal(run_bash.available({} as Settings, tool_model), false);
  try {
    assert.throws(() => tool("start_background_task").execute(context("full", null).ctx, { name: "x", command: "ls", shell: "bash" }), /Git Bash, which was not found/);
  } finally {
    await init_git_bash(system_probe);
  }
});

test("run_bash runs in the project folder with UTF-8 output from bash and Windows programs", async (t) => {
  if (!needs_bash(t)) return;
  const { result, progress } = await bash({ command: "pwd; printf '%s\\n' 'grüße'; cmd //c echo grüße", cwd: "sub" });
  assert.equal(result.status, "done", result.text);
  assert.match(result.text, /^exit code 0 after/);
  assert.match(result.text, /vx-tools-bash-[^\n]*\/sub\n/);
  assert.match(result.text, /grüße\ngrüße/);
  assert.doesNotMatch(result.text, /chcp|65001/);
  assert.equal(result.view?.kind === "command" && result.view.shell, "Git Bash");
  assert.equal(result.view?.kind === "command" && result.view.cwd, "sub");
  assert.equal(progress[0]?.can_background, true);
});

test("run_bash passes quotes and backslashes through to bash unchanged", async (t) => {
  if (!needs_bash(t)) return;
  const { result } = await bash({ command: `printf '%s|' 'a\\b' "C:\\\\x" "q\\"x" a\\\\b` });
  assert.equal(result.status, "done", result.text);
  assert.match(result.text, /\na\\b\|C:\\x\|q"x\|a\\b\|$/);
});

test("run_bash reports exit codes, signals and timeouts", async (t) => {
  if (!needs_bash(t)) return;
  const failed = await bash({ command: "echo broken >&2; exit 3" });
  assert.equal(failed.result.status, "failed");
  assert.match(failed.result.text, /^exit code 3 after/);
  assert.match(failed.result.text, /broken/);
  assert.equal(failed.result.view?.kind === "command" && failed.result.view.exit_code, 3);
  const signalled = await bash({ command: "kill -TERM $$" });
  assert.equal(signalled.result.status, "failed");
  assert.match(signalled.result.text, /^exit code 143 after/);
  assert.match(signalled.result.text, /\[the shell was terminated by SIGTERM\]/);
  const slow = await bash({ command: "sleep 20", timeout_ms: 1500 });
  assert.equal(slow.result.view?.kind === "command" && slow.result.view.timed_out, true);
  assert.match(slow.result.text, /^timed out after [\d.]+ s; for longer work raise timeout_ms \(at most 3600000\) or use start_background_task with shell bash/);
});

test("the POSIX floor blocks run_bash without asking and the card says Git Bash", async () => {
  const { result, requests, stub } = await bash({ command: "rm -rf /c/Windows/System32" }, "ask", null);
  assert.equal(result.status, "failed");
  assert.match(result.text, /^Blocked \(deleting Windows/);
  assert.equal(result.view?.kind === "command" && result.view.shell, "Git Bash");
  assert.equal(requests.length, 0);
  assert.equal(stub.records[0]?.tool, "run_bash");
});

test("ask mode shows a Git Bash approval card and a denial runs nothing", async () => {
  const { result, requests } = await bash({ command: "touch marker.txt" }, "ask", { approved: false, grant: "once", feedback: "" });
  assert.equal(result.status, "denied");
  assert.equal(requests[0]?.kind === "command" && requests[0].shell, "bash");
  assert.equal(result.view?.kind === "command" && result.view.shell, "Git Bash");
  await assert.rejects(fs.access(path.join(root, "marker.txt")));
});

test("start_background_task takes a shell and the task keeps it", async (t) => {
  if (!needs_bash(t)) return;
  const { ctx } = context("full", null, "chat-bash-bg");
  const result = await tool("start_background_task").execute(ctx, { name: "Long", command: "sleep 100", shell: "bash" });
  assert.equal(result.status, "done", result.text);
  assert.deepEqual(spawned.at(-1), { command: "sleep 100", cwd: root, shell: "bash" });
  assert.equal(result.view?.kind === "background" && result.view.shell, "Git Bash");
  const [task] = list_background("chat-bash-bg");
  assert.equal(task?.shell, "bash");
  const read = await tool("get_background_task").execute(ctx, { id: task?.id ?? "" });
  assert.match(read.text, /\nShell: Git Bash\nCommand: sleep 100\n/);
  await tool("cancel_background_task").execute(ctx, { id: task?.id ?? "" });
  const plain = await tool("start_background_task").execute(ctx, { name: "Default", command: "Write-Output hi" });
  assert.equal(plain.view?.kind === "background" && plain.view.shell, "PowerShell");
  assert.equal(spawned.at(-1)?.shell, "powershell");
  assert.throws(() => tool("start_background_task").execute(ctx, { name: "x", command: "ls", shell: "zsh" }), /shell must be powershell or bash/);
});

test("stored background tasks without a shell load as PowerShell", () => {
  const parsed = parse_stored_file({ tasks: [{ id: "bg_1", chat_id: "c", command: "npm test", status: "completed" }, { id: "bg_2", chat_id: "c", command: "make", status: "failed", shell: "bash" }] }, new Date().toISOString());
  assert.deepEqual(parsed.records.map((record) => record.shell), ["powershell", "bash"]);
});

test("a running run_bash command can be moved into the background as a Git Bash task", async (t) => {
  if (!needs_bash(t)) return;
  const state = context("full", null, "chat-bash-move", "call-move");
  const running = tool("run_bash").execute(state.ctx, { command: "sleep 2; echo moved-done", timeout_ms: 60_000 });
  assert.equal(move_to_background("chat-bash-other", "call-move").status, "finished");
  for (let attempt = 0; attempt < 200 && move_to_background("chat-bash-move", "call-move").status !== "moved"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const result = await running;
  assert.equal(result.view?.kind === "background" && result.view.shell, "Git Bash", result.text);
  const [task] = list_background("chat-bash-move");
  assert.equal(task?.shell, "bash");
  await task_ended("chat-bash-move", task?.id ?? "");
  assert.equal(list_background("chat-bash-move")[0]?.status, "completed");
});

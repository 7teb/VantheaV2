import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { PermissionMode, ToolProgress } from "../shared/chat.ts";
import type { BackgroundTask } from "../shared/ipc/work.ts";
import {
  adopt_background,
  find_background,
  init_background,
  list_background,
  max_running_tasks,
  on_background_finished,
  remove_chat_background,
  start_background,
} from "../electron/background/manager.ts";
import { background_event_text } from "../electron/background/event-text.ts";
import { run_shell, type ShellDetach } from "../electron/shell/run.ts";
import { can_hand_off, move_to_background, moved_result, offer_handoff, take_auto_moved, withdraw_handoff } from "../electron/tools/shell/handoff.ts";
import { parse_run } from "../electron/tools/shell/run-command.ts";
import { shell_tools } from "../electron/tools/shell/index.ts";
import type { ToolContext, ToolProfile } from "../electron/tools/types.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

type FakeChild = EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough };

let root = "";
let data_file = "";
const killed: (number | null)[] = [];

const fake_child = (pid: number): FakeChild => Object.assign(new EventEmitter(), { pid, stdout: new PassThrough({ encoding: "utf8" }), stderr: new PassThrough({ encoding: "utf8" }) });

const options = () => ({
  data_file,
  spawner: () => fake_child(5000) as unknown as ChildProcess,
  kill: (pid: number | null) => killed.push(pid),
  kill_sync: (pid: number | null) => killed.push(pid),
});

const live_run = (child: FakeChild) => {
  const offered: ShellDetach[] = [];
  const outcome = run_shell(
    {
      command: "npm run build",
      cwd: root,
      timeout_ms: 60_000,
      signal: new AbortController().signal,
      on_output: () => undefined,
      on_detachable: (detach) => offered.push(detach),
    },
    () => child as unknown as ChildProcess,
  );
  return { detach: offered[0], outcome };
};

const scope = (chat_id: string, call_id: string) => ({ chat_id, turn_id: "turn-1", call_id, project_root: root });

const start_input = (chat_id: string) => ({ chat_id, turn_id: "turn-1", project_root: root, cwd: "sub", name: "npm run build", command: "npm run build", shell: "powershell" as const });

const settle = () => new Promise((resolve) => setImmediate(resolve));

const wait_for = async (check: () => boolean, limit_ms = 15_000, refresh: () => Promise<void> = async () => undefined) => {
  const started = Date.now();
  await refresh();
  while (!check()) {
    if (Date.now() - started > limit_ms) {
      throw new Error("timed out waiting for the handoff state");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    await refresh();
  }
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-handoff-"));
  await fs.mkdir(path.join(root, "sub"));
  data_file = path.join(root, "state", "background.json");
  await init_background(options());
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("an adopted command keeps its process, start time and output, and finishes like a started task", async () => {
  const finished: { task: BackgroundTask; event: string }[] = [];
  const stop = on_background_finished((task, output) => finished.push({ task, event: background_event_text(task, output) }));
  const child = fake_child(4242);
  const run = live_run(child);
  const run_started = Date.now();
  child.stdout.write("compiling\n");
  await settle();
  const adopted = adopt_background(start_input("chat-a"), run.detach);
  assert.ok(adopted.status === "moved");
  assert.equal(adopted.task.status, "running");
  assert.equal(adopted.task.cwd, "sub");
  assert.ok(Math.abs(Date.parse(adopted.task.started_at) - run_started) < 1000);
  assert.match(adopted.task.output_tail, /^compiling/);
  const outcome = await run.outcome;
  assert.ok(outcome.kind === "detached");
  assert.equal(outcome.task_id, adopted.task.id);
  child.stdout.write("done\n");
  await settle();
  child.emit("close", 0);
  await wait_for(() => finished.length === 1);
  stop();
  assert.equal(finished[0]?.task.status, "completed");
  assert.equal(finished[0]?.task.exit_code, 0);
  assert.match(finished[0]?.event ?? "", /Output:\ncompiling\ndone/);
  const stored_status = async () => {
    if (!existsSync(data_file)) {
      return "";
    }
    const stored = JSON.parse(await fs.readFile(data_file, "utf8")) as { tasks: { id: string; status: string; output: { head: string } }[] };
    const record = stored.tasks.find((entry) => entry.id === adopted.task.id);
    return record ? `${record.status} ${record.output.head}` : "";
  };
  let stored = "";
  await wait_for(() => stored.startsWith("completed"), 5000, async () => {
    stored = await stored_status();
  });
  assert.match(stored, /^completed compiling\ndone/);
});

test("cancelling an adopted task kills its process tree by pid", () => {
  const child = fake_child(4343);
  const run = live_run(child);
  const adopted = adopt_background(start_input("chat-b"), run.detach);
  assert.ok(adopted.status === "moved");
  remove_chat_background("chat-b");
  assert.equal(killed.at(-1), 4343);
});

test("a full manager leaves the command in the foreground and a finished command is not adopted", async () => {
  const running = list_background("chat-full").length;
  for (let index = running; index < max_running_tasks; index += 1) {
    await start_background({ ...start_input("chat-full"), cwd: ".", name: `job ${index}`, command: `job ${index}` });
  }
  const child = fake_child(4444);
  const run = live_run(child);
  assert.deepEqual(adopt_background(start_input("chat-c"), run.detach), { status: "full" });
  assert.equal(child.listenerCount("close"), 1);
  remove_chat_background("chat-full");
  child.emit("exit", 0);
  assert.deepEqual(adopt_background(start_input("chat-c"), run.detach), { status: "finished" });
  child.emit("close", 0);
  const outcome = await run.outcome;
  assert.ok(outcome.kind === "exited");
  assert.deepEqual(list_background("chat-c"), []);
});

test("a move needs a live offer for that chat and call, and each offer moves once", () => {
  assert.equal(can_hand_off({ profile: "main" }), true);
  assert.equal(can_hand_off({ profile: "plan" }), true);
  assert.equal(can_hand_off({ profile: "worker" }), false);
  assert.equal(can_hand_off({ profile: "explore" }), false);
  assert.deepEqual(move_to_background("chat-d", "c1_0"), { status: "finished" });
  const run = live_run(fake_child(4545));
  offer_handoff(scope("chat-d", "c1_0"), { command: "npm run build\nnpm test", cwd: "sub", shell: "powershell" }, run.detach, null);
  assert.deepEqual(move_to_background("chat-other", "c1_0"), { status: "finished" });
  const moved = move_to_background("chat-d", "c1_0");
  assert.ok(moved.status === "moved");
  const found = find_background(moved.task_id, "chat-d");
  assert.equal(found.task?.name, "npm run build");
  assert.equal(found.task?.command, "npm run build\nnpm test");
  assert.deepEqual(move_to_background("chat-d", "c1_0"), { status: "finished" });
  const withdrawn_child = fake_child(4646);
  const withdrawn = live_run(withdrawn_child);
  offer_handoff(scope("chat-d", "c2_0"), { command: "npm test", cwd: ".", shell: "powershell" }, withdrawn.detach, null);
  withdraw_handoff(scope("chat-d", "c2_0"));
  assert.deepEqual(move_to_background("chat-d", "c2_0"), { status: "finished" });
  withdrawn_child.emit("close", 0);
  remove_chat_background("chat-d");
});

test("an offer with an auto delay moves a still running command by itself, and a withdrawn offer never moves", async () => {
  const child = fake_child(4747);
  const run = live_run(child);
  const call = scope("chat-auto", "c1_0");
  offer_handoff(call, { command: "npm run build", cwd: ".", shell: "powershell" }, run.detach, 20);
  const outcome = await run.outcome;
  assert.equal(outcome.kind, "detached");
  assert.equal(take_auto_moved(call), true);
  assert.equal(take_auto_moved(call), false);
  assert.equal(outcome.kind === "detached" && find_background(outcome.task_id, "chat-auto").task?.status, "running");
  const result = outcome.kind === "detached" ? moved_result("npm run build", "powershell", null, outcome, true) : null;
  assert.match(result?.text ?? "", /^This command was still running after [\d.]+ s, so the app moved it to the background\. It keeps running as background task /);
  const kept_child = fake_child(4848);
  const kept = live_run(kept_child);
  const kept_call = scope("chat-auto", "c2_0");
  offer_handoff(kept_call, { command: "npm test", cwd: ".", shell: "powershell" }, kept.detach, 20);
  withdraw_handoff(kept_call);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(take_auto_moved(kept_call), false);
  kept_child.emit("close", 0);
  assert.equal((await kept.outcome).kind, "exited");
  child.emit("close", 0);
  remove_chat_background("chat-auto");
});

test("auto_background defaults to true and can be turned off", () => {
  assert.equal(parse_run({ command: "npm test" }).auto_background, true);
  assert.equal(parse_run({ command: "npm test", auto_background: false }).auto_background, false);
  assert.throws(() => parse_run({ command: "npm test", auto_background: "no" }), /auto_background must be a boolean/);
});

const run_command = shell_tools.find((entry) => entry.spec.name === "run_command");

const context = (chat_id: string, profile: ToolProfile, mode: PermissionMode = "full") => {
  const progress: ToolProgress[] = [];
  const ctx: ToolContext = {
    chat_id,
    turn_id: "turn-real",
    call_id: "c1_0",
    project_root: root,
    user_request: "build it",
    mode,
    profile,
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal: new AbortController().signal,
    progress: (entry) => progress.push(entry),
    approve: async () => {
      throw new Error("no approval expected");
    },
    side_model: async () => "",
    review: review_stub(),
    message_main: null,
    send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
  return { ctx, progress };
};

test("run_command in the main chat hands the live PowerShell process to the background and the model hears the result", async () => {
  assert.ok(run_command);
  const finished: BackgroundTask[] = [];
  const stop = on_background_finished((task) => finished.push(task));
  const { ctx, progress } = context("chat-real", "main");
  const pending = run_command.execute(ctx, { command: "Write-Output before; Start-Sleep -Milliseconds 1500; Write-Output after" });
  await wait_for(() => progress.some((entry) => (entry.output_tail ?? "").includes("before")));
  assert.deepEqual(progress[0], { label: "", lines: 0, output_tail: null, can_background: true });
  assert.ok(progress.every((entry) => entry.can_background === true));
  const moved = move_to_background("chat-real", "c1_0");
  assert.ok(moved.status === "moved");
  const result = await pending;
  assert.equal(result.status, "done");
  assert.match(result.text, new RegExp(`^The user moved this command to the background after [\\d.]+ s\\. It keeps running as background task ${moved.task_id}, now without a timeout;`));
  assert.match(result.text, /\nOutput so far:\nbefore/);
  assert.equal(result.view?.kind === "background" && result.view.task_id, moved.task_id);
  assert.equal(result.view?.kind === "background" && result.view.command, "Write-Output before; Start-Sleep -Milliseconds 1500; Write-Output after");
  await wait_for(() => finished.length === 1);
  stop();
  assert.equal(finished[0]?.status, "completed");
  assert.equal(finished[0]?.exit_code, 0);
  assert.match(finished[0]?.output_tail ?? "", /before\r?\nafter/);
});

test("run_command in a sub-agent never offers a handoff", async () => {
  assert.ok(run_command);
  const { ctx, progress } = context("chat-worker", "worker");
  const result = await run_command.execute(ctx, { command: "Write-Output worker" });
  assert.equal(result.status, "done");
  assert.ok(progress.length > 0);
  assert.ok(progress.every((entry) => entry.can_background === undefined));
  assert.deepEqual(move_to_background("chat-worker", "c1_0"), { status: "finished" });
});

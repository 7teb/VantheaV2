import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, test } from "node:test";
import type { BackgroundTask } from "../shared/ipc/work.ts";
import {
  cancel_background,
  clear_background,
  find_background,
  init_background,
  list_background,
  mark_result_read,
  max_running_tasks,
  on_background_changed,
  on_background_finished,
  remove_chat_background,
  result_was_read,
  shutdown_background_sync,
  start_background,
  type BackgroundStart,
} from "../electron/background/manager.ts";
import { background_event_text } from "../electron/background/event-text.ts";
import { estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";
import { output_collector } from "../electron/shell/output.ts";
import { exit_grace_ms } from "../electron/shell/process.ts";
import { write_json, writes_settled } from "../electron/storage/json-file.ts";

type FakeChild = EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough };

let root = "";
let data_file = "";
const children: FakeChild[] = [];
const spawned: { command: string; cwd: string }[] = [];
const killed: (number | null)[] = [];

const spawner = (command: string, cwd: string) => {
  const child = Object.assign(new EventEmitter(), { pid: 7000 + children.length, stdout: new PassThrough(), stderr: new PassThrough() });
  children.push(child);
  spawned.push({ command, cwd });
  return child as unknown as ChildProcess;
};

const options = () => ({ data_file, spawner, kill: (pid: number | null) => killed.push(pid), kill_sync: (pid: number | null) => killed.push(pid) });

const start = (chat_id: string, name: string, command: string, extra: Partial<BackgroundStart> = {}) =>
  start_background({ chat_id, turn_id: "turn", project_root: root, cwd: ".", name, command, shell: "powershell", ...extra });

const wait_for = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for background task state");
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-background-"));
  await fs.mkdir(path.join(root, "tools"));
  data_file = path.join(root, "state", "background.json");
  await init_background(options());
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("a task runs, collects output and reports when it finishes", async () => {
  const finished: BackgroundTask[] = [];
  const changed: BackgroundTask[] = [];
  const stop_finished = on_background_finished((task) => finished.push(task));
  const stop_changed = on_background_changed((task) => changed.push(task));
  const task = await start("chat-a", "Long analysis", "python long.py", { cwd: "tools" });
  assert.equal(task.status, "running");
  assert.equal(task.cwd, "tools");
  assert.equal(spawned.at(-1)?.cwd, path.join(await fs.realpath(root), "tools"));
  assert.equal(changed.at(-1)?.status, "running");
  const child = children.at(-1);
  child?.stdout.write("first output\n");
  child?.stderr.write("\u001b[31mwarning\u001b[0m\n");
  await wait_for(() => (find_background(task.id, "chat-a").task?.output_tail ?? "").includes("warning"));
  child?.emit("close", 0);
  await wait_for(() => finished.length === 1);
  assert.equal(finished[0]?.status, "completed");
  assert.equal(finished[0]?.exit_code, 0);
  assert.match(finished[0]?.output_tail ?? "", /first output\nwarning/);
  assert.equal(changed.at(-1)?.status, "completed");
  assert.equal(result_was_read(task.id), false);
  mark_result_read(task.id);
  assert.equal(result_was_read(task.id), true);
  stop_finished();
  stop_changed();
});

test("ids resolve by unique prefix inside the owning chat only", async () => {
  const task = await start("chat-b", "Build", "npm run build");
  assert.equal(find_background(task.id.slice(0, -4), "chat-b").task?.id, task.id);
  assert.equal(find_background(task.id, "chat-other").task, null);
  await start("chat-b", "Second", "npm test");
  const ambiguous = find_background("bg_", "chat-b");
  assert.equal(ambiguous.task, null);
  assert.match("error" in ambiguous ? ambiguous.error : "", /matches 2 background tasks/);
});

test("a non-zero exit or a spawn error marks the task failed", async () => {
  const failing = await start("chat-c", "Failing", "exit 3");
  children.at(-1)?.emit("close", 3);
  const broken = await start("chat-c", "Broken", "missing.exe");
  children.at(-1)?.emit("error", new Error("spawn powershell.exe ENOENT"));
  await wait_for(() => list_background("chat-c").every((task) => task.status === "failed"));
  assert.equal(find_background(failing.id, "chat-c").task?.exit_code, 3);
  assert.match(find_background(broken.id, "chat-c").task?.output_tail ?? "", /ENOENT/);
});

test("cancel kills the process tree and a later exit does not change the status", async () => {
  const task = await start("chat-d", "Cancelable", "npm run package");
  const child = children.at(-1);
  const cancelled = cancel_background(task.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(killed.at(-1), child?.pid);
  child?.emit("close", 1);
  assert.equal(find_background(task.id, "chat-d").task?.status, "cancelled");
  assert.throws(() => cancel_background("bg_missing"), /not found/);
});

test("a shell that exits while a descendant holds its output open finishes after the exit grace, once", async () => {
  const finished: BackgroundTask[] = [];
  const stop_finished = on_background_finished((task) => finished.push(task));
  const held = await start("chat-g", "Detached child", "sleep 25 & echo done", { shell: "bash" });
  children.at(-1)?.emit("exit", 0, null);
  const closed = await start("chat-g", "Plain", "echo done", { shell: "bash" });
  const closing = children.at(-1);
  closing?.emit("exit", 0, null);
  closing?.emit("close", 0, null);
  assert.equal(find_background(held.id, "chat-g").task?.status, "running");
  assert.deepEqual(finished.map((task) => task.id), [closed.id]);
  await new Promise((resolve) => setTimeout(resolve, exit_grace_ms + 100));
  stop_finished();
  assert.deepEqual(finished.map((task) => task.id), [closed.id, held.id]);
  assert.equal(finished[1]?.status, "completed");
  assert.equal(finished[1]?.exit_code, 0);
  clear_background("chat-g");
});

test("the running limit holds when starts race across the cwd lookup", async () => {
  const before_count = children.length;
  const running = list_background("chat-b").filter((task) => task.status === "running").length;
  const room = max_running_tasks - running;
  const attempts = await Promise.allSettled([...Array(room + 3).keys()].map((index) => start("chat-limit", `Task ${index}`, `job ${index}`)));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, room);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 3);
  assert.equal(children.length - before_count, room);
  remove_chat_background("chat-limit");
  remove_chat_background("chat-b");
  assert.deepEqual(list_background("chat-limit"), []);
});

test("shutdown interrupts running tasks atomically and a reload keeps them stopped", async () => {
  await writes_settled(data_file);
  const task = await start("chat-e", "Interrupted", "Start-Sleep 999");
  const pid = children.at(-1)?.pid;
  shutdown_background_sync();
  assert.equal(find_background(task.id, "chat-e").task?.status, "interrupted");
  assert.equal(killed.at(-1), pid);
  const stored_status = async () => {
    const stored = JSON.parse(await fs.readFile(data_file, "utf8")) as { tasks: { id: string; status: string }[] };
    return stored.tasks.find((entry) => entry.id === task.id)?.status;
  };
  assert.equal(await stored_status(), "interrupted");
  await writes_settled(data_file);
  assert.equal(await stored_status(), "interrupted");
  assert.deepEqual((await fs.readdir(path.dirname(data_file))).filter((name) => name.endsWith(".tmp")), []);
  await init_background({
    ...options(),
    spawner: () => {
      throw new Error("a persisted task must not restart");
    },
  });
  assert.equal(find_background(task.id, "chat-e").task?.status, "interrupted");
  assert.equal(list_background("chat-a")[0]?.status, "completed");
  clear_background("chat-e");
  assert.deepEqual(list_background("chat-e"), []);
});

test("a task left running in the data file loads as interrupted", async () => {
  await write_json(data_file, {
    version: 1,
    tasks: [{ id: "bg_old", chat_id: "chat-f", name: "Old", command: "x", cwd: ".", status: "running", started_at: "2026-01-01T00:00:00.000Z" }],
  });
  await init_background(options());
  const task = find_background("bg_old", "chat-f").task;
  assert.equal(task?.status, "interrupted");
  assert.notEqual(task?.ended_at, null);
  const stored = JSON.parse(await fs.readFile(data_file, "utf8")) as { tasks: { id: string; status: string }[] };
  assert.deepEqual(stored.tasks.map((entry) => [entry.id, entry.status]), [["bg_old", "interrupted"]]);
});

const output_marker = /\n\[output over the 25000-token cap per tool result: (\d+) characters omitted here\. Redirect the output to a file and read that file, or filter the output, to see them\.\]\n/;

test("large output keeps head and tail within the cap, survives a restart and the end notice counts what it leaves out", async () => {
  const finished: { task: BackgroundTask; event: string }[] = [];
  const stop = on_background_finished((task, output) => finished.push({ task, event: background_event_text(task, output) }));
  const task = await start("chat-g", "Huge log", "python huge.py");
  const child = children.at(-1);
  const lines = Array.from({ length: 30_000 }, (_, index) => `log ${String(index).padStart(5, "0")} ${"z".repeat(20)}\n`).join("");
  child?.stdout.write(lines);
  await wait_for(() => (find_background(task.id, "chat-g").task?.output_tail ?? "").includes("log 29999"));
  child?.emit("close", 0);
  await wait_for(() => finished.length === 1);
  stop();
  const found = find_background(task.id, "chat-g");
  assert.ok(found.task);
  const text = found.task.output_tail;
  assert.ok(estimate_tokens(text) <= result_cap_tokens);
  assert.ok(text.startsWith("log 00000 "));
  assert.ok(text.endsWith("log 29999 zzzzzzzzzzzzzzzzzzzz\n"));
  const omitted = Number(text.match(output_marker)?.[1] ?? 0);
  assert.equal(omitted, lines.length - text.length + (text.match(output_marker)?.[0].length ?? 0));
  const event = finished[0]?.event ?? "";
  assert.ok(event.includes(`Output, the last 6000 characters (the ${lines.length - 6000} characters before them are omitted here; get_background_task returns the output with its start and end up to the 25000-token cap per tool result):\n`));
  assert.ok(event.includes("log 29999 zzzzzzzzzzzzzzzzzzzz"));
  assert.doesNotMatch(event, /Output tail/);
  shutdown_background_sync();
  await init_background(options());
  assert.equal(find_background(task.id, "chat-g").task?.output_tail, text);
  clear_background("chat-g");
});

test("a record stored by an older version with only an 8000-character tail loads and shows that tail", async () => {
  const tail = `older output ${"t".repeat(7_980)}`;
  await write_json(data_file, {
    version: 1,
    tasks: [{ id: "bg_legacy", chat_id: "chat-h", name: "Legacy", command: "x", cwd: ".", status: "completed", exit_code: 0, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-01T00:01:00.000Z", output_tail: tail }],
  });
  await init_background(options());
  const found = find_background("bg_legacy", "chat-h");
  assert.equal(found.task?.output_tail, tail);
  assert.equal(found.task ? found.output.chars() : 0, tail.length);
  const short = background_event_text(found.task as BackgroundTask, found.task ? found.output : output_collector());
  assert.match(short, /Output, the last 6000 characters \(the 1993 characters before them are omitted here;/);
  assert.match(background_event_text(found.task as BackgroundTask, output_collector({ head: "done\n", tail: "", chars: 5 })), /\n\nOutput:\ndone\n\n/);
});

test("an older record whose stored tail filled the old 8000-character limit says that its start is lost", async () => {
  const tail = "u".repeat(8_000);
  await write_json(data_file, {
    version: 1,
    tasks: [{ id: "bg_cut", chat_id: "chat-i", name: "Cut", command: "x", cwd: ".", status: "completed", exit_code: 0, started_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-01T00:01:00.000Z", output_tail: tail }],
  });
  await init_background(options());
  const found = find_background("bg_cut", "chat-i");
  assert.equal(found.task?.output_tail, `[Stored by an older VantheaX version that kept only the last 8000 characters of the output; everything before them is lost.]\n${tail}`);
  clear_background("chat-i");
});

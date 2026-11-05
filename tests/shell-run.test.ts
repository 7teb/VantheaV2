import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { result_cap_tokens } from "../electron/context/estimate.ts";
import { run_shell, type ShellDetach } from "../electron/shell/run.ts";

const turn = () => new Promise((resolve) => setImmediate(resolve));

test("output that arrives after the command settled is not reported", async () => {
  const stdout = new PassThrough({ encoding: "utf8" });
  const child = Object.assign(new EventEmitter(), { pid: undefined, stdout, stderr: new PassThrough({ encoding: "utf8" }) }) as unknown as ChildProcess;
  let reports = 0;
  const outcome = run_shell(
    {
      command: "Write-Output first",
      cwd: ".",
      timeout_ms: 60_000,
      signal: new AbortController().signal,
      on_output: () => {
        reports += 1;
      },
    },
    () => child,
  );
  stdout.write("first\n");
  await turn();
  child.emit("close", 0);
  const result = await outcome;
  stdout.write("late\n");
  await turn();
  assert.equal(reports, 1);
  assert.ok(result.kind === "exited");
  assert.equal(result.exit_code, 0);
  assert.match(result.output.text(result_cap_tokens), /first/);
  assert.doesNotMatch(result.output.text(result_cap_tokens), /late/);
});

type FakeChild = EventEmitter & { pid: undefined; stdout: PassThrough; stderr: PassThrough };

const detachable_run = (timeout_ms = 60_000) => {
  const child: FakeChild = Object.assign(new EventEmitter(), { pid: undefined, stdout: new PassThrough({ encoding: "utf8" }), stderr: new PassThrough({ encoding: "utf8" }) });
  const controller = new AbortController();
  const offered: ShellDetach[] = [];
  let reports = 0;
  const outcome = run_shell(
    {
      command: "npm test",
      cwd: ".",
      timeout_ms,
      signal: controller.signal,
      on_output: () => {
        reports += 1;
      },
      on_detachable: (detach) => offered.push(detach),
    },
    () => child as unknown as ChildProcess,
  );
  return { child, controller, offered, outcome, reports: () => reports };
};

test("a running command can be detached once with its process and the output so far", async () => {
  const run = detachable_run(80);
  assert.equal(run.offered.length, 1);
  run.child.stdout.write("before\n");
  await turn();
  const taken = run.offered[0]("bg_1");
  assert.ok(taken);
  assert.equal(taken.child, run.child);
  assert.match(taken.output.text(result_cap_tokens), /^before/);
  assert.equal(run.offered[0]("bg_2"), null);
  const result = await run.outcome;
  assert.ok(result.kind === "detached");
  assert.equal(result.task_id, "bg_1");
  assert.equal(result.output, taken.output);
  for (const event of ["error", "exit", "close"]) {
    assert.equal(run.child.listenerCount(event), 0, event);
  }
  assert.equal(run.child.stdout.listenerCount("data"), 0);
  assert.equal(run.child.stderr.listenerCount("data"), 0);
  assert.equal(getEventListeners(run.controller.signal, "abort").length, 0);
  run.controller.abort(new Error("turn stopped"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.doesNotMatch(taken.output.text(result_cap_tokens), /timeout/);
  assert.equal(run.reports(), 1);
});

test("a command that already exited or settled cannot be detached", async () => {
  const exited = detachable_run();
  exited.child.emit("exit", 0);
  assert.equal(exited.offered[0]("bg_3"), null);
  exited.child.emit("close", 0);
  const result = await exited.outcome;
  assert.ok(result.kind === "exited");
  assert.equal(result.exit_code, 0);
  const closed = detachable_run();
  closed.child.emit("close", 2);
  await closed.outcome;
  assert.equal(closed.offered[0]("bg_4"), null);
  const aborted = detachable_run();
  aborted.controller.abort(new Error("turn stopped"));
  await assert.rejects(aborted.outcome, /turn stopped/);
  assert.equal(aborted.offered[0]("bg_5"), null);
});

const run_real = async (command: string) => {
  const outcome = await run_shell({ command, cwd: ".", timeout_ms: 60_000, signal: new AbortController().signal, on_output: () => undefined });
  assert.ok(outcome.kind === "exited");
  return { exit_code: outcome.exit_code, output: outcome.output.text(result_cap_tokens) };
};

test("real PowerShell errors do not show the UTF-8 setup, and exit codes and output stay the same", async () => {
  const native = await run_real('cmd /c "echo native failure 1>&2" 2>&1');
  assert.match(native.output, /native failure/);
  assert.match(native.output, /At line:2 char:1/);
  assert.doesNotMatch(native.output, /UTF8|OutputEncoding/);
  const cmdlet = await run_real("Get-Item C:/definitely/missing/path");
  assert.equal(cmdlet.exit_code, 1);
  assert.doesNotMatch(cmdlet.output, /UTF8|OutputEncoding/);
  assert.equal((await run_real("exit 3")).exit_code, 3);
  assert.equal(native.exit_code, 0);
  assert.equal((await run_real("cmd /c exit 5")).exit_code, 5);
  assert.equal((await run_real("cmd /c exit 5; Write-Output ok")).exit_code, 0);
  assert.match((await run_real('Write-Output "äöü ✓"')).output, /äöü ✓/);
  const top_level = await run_real('Write-Error "shown with its header"');
  assert.match(top_level.output, /not part of the command/);
});

test("the exit code follows the last statement and keeps output, codes set by the command and strict mode intact", async () => {
  const table = await run_real("[pscustomobject]@{alpha=1;beta=2}");
  assert.equal(table.exit_code, 0);
  assert.match(table.output, /alpha\s+beta/);
  const table_then_error = await run_real("[pscustomobject]@{alpha=1;beta=2}; Get-Item C:/definitely/missing/path");
  assert.equal(table_then_error.exit_code, 1);
  assert.match(table_then_error.output, /alpha\s+beta/);
  assert.doesNotMatch(table_then_error.output, /SetShouldExit|exit code handling/);
  assert.equal((await run_real('$host.SetShouldExit(4); cmd /c "echo warn 1>&2" 2>&1')).exit_code, 4);
  const strict = await run_real("Set-StrictMode -Version Latest; Write-Output ok");
  assert.equal(strict.exit_code, 0);
  assert.doesNotMatch(strict.output, /LASTEXITCODE/);
  assert.equal((await run_real("Set-StrictMode -Version Latest; Get-Item C:/definitely/missing/path")).exit_code, 1);
  const backtick = await run_real("Write-Output hi `");
  assert.doesNotMatch(backtick.output, /SetShouldExit|True/);
});

test("strings piped from PowerShell into a native program arrive as UTF-8 without a BOM", async () => {
  const piped = await run_real(`"äöü" | node -e "process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString('hex')))"`);
  assert.equal(piped.exit_code, 0);
  assert.match(piped.output, /^c3a4c3b6c3bc/);
  assert.doesNotMatch(piped.output, /efbbbf/);
});

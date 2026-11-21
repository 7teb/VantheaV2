import { agent_approval_id, main_approval_id } from "../../shared/api/approval-id.ts";
import type { ApprovalInfo, PromptStarted, RunResult, WaitUntil } from "../../shared/api/contract.ts";
import { build_run_result } from "../../shared/api/result.ts";
import type { AssistantMessage } from "../../shared/chat.ts";
import type { FinalStatus, TurnEvent } from "../../shared/events.ts";
import type { TurnStarted } from "../../shared/ipc/chats.ts";
import type { EventPayload } from "../../shared/ipc/index.ts";
import { open_questions } from "../../shared/questions.ts";
import type { EventTap } from "../ipc/handle.ts";
import type { RunOptions } from "../turn/run-options.ts";
import { RequestError } from "./body.ts";
import { publish } from "./events.ts";
import type { ApiContext } from "./router.ts";

type Run = {
  run_id: string;
  session_id: string;
  message_ids: string[];
  ended: Map<string, FinalStatus>;
  started_at: string;
  settled: boolean;
  idle: AbortController;
  done: Promise<void>;
  finish: () => void;
  first_end: Promise<void>;
  first_ended: () => void;
};

type Admission = { count: number; appended: string[]; ended: Map<string, FinalStatus> };

const runs = new Map<string, Run>();
const open_runs = new Map<string, Run>();
const admissions = new Map<string, Admission>();
const settling = new Set<Promise<void>>();
let stopped = new AbortController();
let remove_tap: (() => void) | null = null;

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const record_end = (run: Run, message_id: string, status: FinalStatus) => {
  run.ended.set(message_id, status);
  if (message_id === run.run_id) {
    run.first_ended();
  }
};

const track_message = ({ chat_id, message }: EventPayload<"chats:appended">) => {
  if (message.role !== "assistant") {
    return;
  }
  const admission = admissions.get(chat_id);
  if (admission) {
    admission.appended.push(message.id);
    return;
  }
  const run = open_runs.get(chat_id);
  if (run && !run.message_ids.includes(message.id)) {
    run.message_ids.push(message.id);
  }
};

const track_end = (event: TurnEvent) => {
  if (event.type !== "end") {
    return;
  }
  admissions.get(event.chat_id)?.ended.set(event.message_id, event.status);
  const run = open_runs.get(event.chat_id);
  if (run?.message_ids.includes(event.message_id)) {
    record_end(run, event.message_id, event.status);
  }
};

const observe: EventTap = (target, name, payload) => {
  if (target !== null) {
    return;
  }
  if (name === "chats:appended") {
    track_message(payload as EventPayload<"chats:appended">);
  }
  if (name === "turn:event") {
    track_end(payload as TurnEvent);
  }
};

export const forget_session_runs = (session_id: string): void => {
  for (const run of [...runs.values()]) {
    if (run.session_id === session_id && run.settled) {
      runs.delete(run.run_id);
    }
  }
};

const tracked_messages = async (context: ApiContext, run: Run) => {
  const chat = await context.invoke("chats:get", run.session_id);
  if (!chat) {
    return null;
  }
  const tracked = new Set(run.message_ids);
  return { chat, messages: chat.messages.filter((message): message is AssistantMessage => message.role === "assistant" && tracked.has(message.id)) };
};

const final_status = async (context: ApiContext, run: Run): Promise<FinalStatus | null> => {
  const last = (await tracked_messages(context, run))?.messages.at(-1);
  if (last && last.status !== "streaming") {
    return last.status;
  }
  return run.ended.get(run.message_ids.at(-1) ?? run.run_id) ?? null;
};

const publish_settled = async (context: ApiContext, run: Run) => {
  const status = await final_status(context, run);
  if (status) {
    publish("run.settled", { session_id: run.session_id, run_id: run.run_id, status }, run.session_id);
  } else {
    console.error(`[api] run ${run.run_id} of session ${run.session_id} settled, but neither the stored chat nor an end event names the status of its last message, so no run.settled was published`);
  }
  if (!context.session_meta(run.session_id)) {
    forget_session_runs(run.session_id);
  }
};

const settle = (context: ApiContext, run: Run) => {
  if (run.settled) {
    return;
  }
  run.settled = true;
  run.idle.abort();
  if (open_runs.get(run.session_id) === run) {
    open_runs.delete(run.session_id);
  }
  run.finish();
  const publishing = publish_settled(context, run).catch((error: unknown) => {
    console.error(`[api] publishing run.settled for run ${run.run_id} of session ${run.session_id} failed:`, error);
  });
  settling.add(publishing);
  void publishing.then(() => settling.delete(publishing));
};

const open_run = (context: ApiContext, session_id: string, started: TurnStarted) => {
  const done = deferred();
  const first_end = deferred();
  const run: Run = {
    run_id: started.message_id,
    session_id,
    message_ids: [started.message_id],
    ended: new Map(),
    started_at: new Date().toISOString(),
    settled: false,
    idle: new AbortController(),
    done: done.promise,
    finish: done.resolve,
    first_end: first_end.promise,
    first_ended: first_end.resolve,
  };
  runs.set(run.run_id, run);
  open_runs.set(session_id, run);
  context.when_idle(session_id, run.idle.signal).then(
    () => settle(context, run),
    (error: unknown) => {
      if (!run.idle.signal.aborted) {
        console.error(`[api] waiting for session ${session_id} to go idle after run ${run.run_id} failed:`, error);
      }
    },
  );
};

const begin_admission = (session_id: string): Admission => {
  const admission = admissions.get(session_id) ?? { count: 0, appended: [], ended: new Map() };
  admission.count += 1;
  admissions.set(session_id, admission);
  return admission;
};

const end_admission = (session_id: string, admission: Admission) => {
  admission.count -= 1;
  if (admission.count > 0 || admissions.get(session_id) !== admission) {
    return;
  }
  admissions.delete(session_id);
  const run = open_runs.get(session_id);
  if (!run) {
    return;
  }
  for (const message_id of admission.appended) {
    if (!run.message_ids.includes(message_id)) {
      run.message_ids.push(message_id);
    }
    const status = admission.ended.get(message_id);
    if (status) {
      record_end(run, message_id, status);
    }
  }
};

export const admit_run = async (context: ApiContext, session_id: string, start: () => Promise<TurnStarted | null>): Promise<PromptStarted | null> => {
  const admission = begin_admission(session_id);
  try {
    const started = await start();
    if (!started) {
      return null;
    }
    const earlier = open_runs.get(session_id);
    if (earlier) {
      settle(context, earlier);
    }
    open_run(context, session_id, started);
    return { run_id: started.message_id, user_message_id: started.user_message_id, message_id: started.message_id };
  } finally {
    end_admission(session_id, admission);
  }
};

export const admit_with_options = async (
  context: ApiContext,
  session_id: string,
  options: RunOptions,
  start: () => Promise<TurnStarted | null>,
): Promise<PromptStarted | null> => {
  const previous = context.run_options(session_id);
  context.set_run_options(session_id, options);
  try {
    return await admit_run(context, session_id, start);
  } catch (error) {
    if (previous) {
      context.set_run_options(session_id, previous);
    } else {
      context.forget_run_options(session_id);
    }
    throw error;
  }
};

export const tracked_run = (run_id: string): boolean => runs.has(run_id);

const require_run = (session_id: string, run_id: string): Run => {
  const run = runs.get(run_id);
  if (!run || run.session_id !== session_id) {
    throw new RequestError(404, "not_found", `run ${run_id} not found in session ${session_id}`);
  }
  return run;
};

export const session_approvals = async (context: ApiContext, chat_id: string): Promise<ApprovalInfo[]> => {
  const main: ApprovalInfo[] = context
    .pending_approvals(chat_id)
    .filter((entry) => entry.key === chat_id)
    .map((entry) => ({ approval_id: main_approval_id(entry.call_id), source: "main", agent_id: null, run_id: null, call_id: entry.call_id, request: entry.request }));
  const { approvals } = await context.invoke("agents:approvals", chat_id);
  const agents: ApprovalInfo[] = approvals.map((entry) => ({
    approval_id: agent_approval_id(entry.agent_id, entry.run_id, entry.call_id),
    source: "agent",
    agent_id: entry.agent_id,
    run_id: entry.run_id,
    call_id: entry.call_id,
    request: entry.request,
  }));
  return [...main, ...agents];
};

export const run_result = async (context: ApiContext, session_id: string, run_id: string): Promise<RunResult> => {
  const run = require_run(session_id, run_id);
  const settled = run.settled || context.chat_idle(session_id);
  const tracked = await tracked_messages(context, run);
  if (!tracked) {
    throw new RequestError(404, "not_found", `session ${session_id} not found`);
  }
  return build_run_result({
    run_id,
    session_id,
    settled,
    messages: tracked.messages,
    questions: open_questions(tracked.chat.messages, tracked.chat.questions),
    approvals: await session_approvals(context, session_id),
    active: context.chat_activity(session_id),
    started_at: run.started_at,
  });
};

const until_aborted = (promise: Promise<void>, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const on_abort = () => reject(signal.reason);
    signal.addEventListener("abort", on_abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", on_abort));
  });

export const wait_run = async (context: ApiContext, session_id: string, run_id: string, until: WaitUntil, signal: AbortSignal): Promise<RunResult> => {
  const run = require_run(session_id, run_id);
  const abort = AbortSignal.any([signal, stopped.signal]);
  if (until === "idle") {
    await until_aborted(run.done, abort);
  } else if (!run.settled) {
    await until_aborted(run.first_end, abort);
    await until_aborted(context.turn_settled(session_id), abort);
  }
  return run_result(context, session_id, run_id);
};

export const start_runs = (context: ApiContext): void => {
  stopped = new AbortController();
  remove_tap?.();
  remove_tap = context.add_event_tap(observe);
};

export const stop_runs = async (context: ApiContext): Promise<void> => {
  remove_tap?.();
  remove_tap = null;
  for (const run of [...open_runs.values()]) {
    settle(context, run);
  }
  await Promise.all([...settling]);
  stopped.abort(new RequestError(503, "shutting_down", "the local API server is shutting down"));
  open_runs.clear();
  runs.clear();
  admissions.clear();
};

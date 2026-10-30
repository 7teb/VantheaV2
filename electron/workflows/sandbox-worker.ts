import { parentPort } from "node:worker_threads";
import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime } from "quickjs-emscripten-core";
import { parse_hook_call, RefusedCall } from "./hook-call.ts";
import { syntax_hint } from "./meta.ts";
import { prelude_source } from "./prelude.ts";
import { sandbox_stack, type HookCall, type HookDraft, type HostMessage, type WorkerMessage } from "./protocol.ts";

type Vm = { runtime: QuickJSRuntime; vm: QuickJSContext; api: QuickJSHandle };

const port = parentPort;

const outbox: HookCall[] = [];

let next_id = 0;

let current: Vm | null = null;

let broken = false;

const post = (message: WorkerMessage) => port?.postMessage(message);

const host_error_text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const fail_hard = (message: string) => {
  broken = true;
  post({ type: "broken", message });
};

const error_message = (vm: QuickJSContext, handle: QuickJSHandle): string => {
  const dumped: unknown = vm.dump(handle);
  handle.dispose();
  if (dumped && typeof dumped === "object") {
    const error = dumped as { name?: unknown; message?: unknown; stack?: unknown };
    const head = `${String(error.name ?? "Error")}: ${String(error.message ?? "")}`;
    return typeof error.stack === "string" && error.stack.trim() ? `${head}\n${error.stack.trimEnd()}` : head;
  }
  return String(dumped);
};

const host_call = (vm: QuickJSContext, kind_handle: QuickJSHandle, payload_handle: QuickJSHandle, scope_handle: QuickJSHandle): QuickJSHandle | undefined => {
  const kind = vm.getString(kind_handle);
  let draft: HookDraft;
  try {
    draft = parse_hook_call(kind, vm.getString(payload_handle));
  } catch (error) {
    if (!(error instanceof RefusedCall)) {
      throw error;
    }
    if (kind === "done" || kind === "failed") {
      outbox.push({ kind: "failed", message: `the script ended with a ${kind} call the sandbox refused: ${error.message}` });
      return undefined;
    }
    return vm.newString(`the sandbox refused this call: ${error.message}`);
  }
  if (draft.kind === "agent") {
    next_id += 1;
    outbox.push({ ...draft, id: next_id, scope: vm.typeof(scope_handle) === "number" ? vm.getNumber(scope_handle) : null });
    return vm.newNumber(next_id);
  }
  if (draft.kind === "workflow") {
    next_id += 1;
    outbox.push({ ...draft, id: next_id });
    return vm.newNumber(next_id);
  }
  outbox.push(draft);
  return undefined;
};

const drain = (state: Vm): boolean => {
  for (;;) {
    const result = state.runtime.executePendingJobs();
    if (result.error) {
      fail_hard(`the script stopped inside the sandbox: ${error_message(state.vm, result.error)}`);
      return false;
    }
    if (result.value === 0) {
      return true;
    }
  }
};

const flush = (ack: number) => {
  post({ type: "batch", ack, items: outbox.splice(0) });
};

const call_api = (state: Vm, method: string, args: QuickJSHandle[]): boolean => {
  const fn = state.vm.getProp(state.api, method);
  const result = state.vm.callFunction(fn, state.vm.undefined, ...args);
  fn.dispose();
  for (const arg of args) {
    arg.dispose();
  }
  if (result.error) {
    fail_hard(`the sandbox prelude failed in ${method}: ${error_message(state.vm, result.error)}`);
    return false;
  }
  result.value.dispose();
  return true;
};

const compile = (state: Vm, source: string, filename: string): { fn: QuickJSHandle } | { error: string } => {
  const result = state.vm.evalCode(source, filename);
  if (result.error) {
    const message = error_message(state.vm, result.error);
    return { error: message.startsWith("SyntaxError") ? `${message}\n${syntax_hint}` : message };
  }
  return { fn: result.value };
};

const open_vm = async (): Promise<Vm | null> => {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();
  runtime.setMaxStackSize(sandbox_stack.script_bytes);
  const vm = runtime.newContext();
  const host = vm.newFunction("host", (kind, payload, scope) => host_call(vm, kind, payload, scope));
  vm.setProp(vm.global, "__vx_host", host);
  host.dispose();
  const prelude = vm.evalCode(prelude_source, "prelude.js");
  if (prelude.error) {
    fail_hard(`the sandbox prelude failed to load: ${error_message(vm, prelude.error)}`);
    return null;
  }
  return { runtime, vm, api: prelude.value };
};

const start = async (message: Extract<HostMessage, { type: "start" }>) => {
  let state: Vm | null;
  try {
    state = await open_vm();
  } catch (error) {
    fail_hard(`the sandbox failed to start: ${host_error_text(error)}`);
    return;
  }
  if (!state) {
    return;
  }
  current = state;
  const compiled = compile(state, message.source, message.filename);
  if ("error" in compiled) {
    post({ type: "compile_failed", message: compiled.error });
    return;
  }
  post({ type: "compiled" });
  if (call_api(state, "start", [compiled.fn, state.vm.newString(message.args_text)]) && drain(state)) {
    flush(0);
  }
};

const settle = (state: Vm, message: Extract<HostMessage, { type: "settle" }>) => {
  if (call_api(state, "settle", [state.vm.newNumber(message.id), message.ok ? state.vm.true : state.vm.false, state.vm.newString(message.text)]) && drain(state)) {
    flush(message.seq);
  }
};

const child = (state: Vm, message: Extract<HostMessage, { type: "child" }>) => {
  const compiled = compile(state, message.source, message.filename);
  const done = "error" in compiled
    ? call_api(state, "settle", [state.vm.newNumber(message.id), state.vm.false, state.vm.newString(`the child workflow ${message.name} does not compile: ${compiled.error}`)])
    : call_api(state, "child", [state.vm.newNumber(message.id), compiled.fn, state.vm.newString(message.args_text), state.vm.newString(message.name)]);
  if (done && drain(state)) {
    flush(message.seq);
  }
};

const running = (message: HostMessage, step: () => void) => {
  try {
    step();
  } catch (error) {
    fail_hard(`the sandbox failed while running the script (on a ${message.type} message): ${host_error_text(error)}`);
  }
};

port?.on("message", (message: HostMessage) => {
  if (broken) {
    return;
  }
  if (message.type === "start") {
    start(message).catch((error: unknown) => fail_hard(`the sandbox failed while running the script (on a start message): ${host_error_text(error)}`));
    return;
  }
  const state = current;
  if (!state) {
    fail_hard(`the sandbox got ${message.type} before it started`);
    return;
  }
  running(message, () => {
    if (message.type === "settle") {
      settle(state, message);
      return;
    }
    child(state, message);
  });
});

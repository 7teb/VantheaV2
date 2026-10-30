import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { sandbox_stack, type HookCall, type HostMessage, type WorkerMessage } from "./protocol.ts";

export type SandboxInput = { source: string; filename: string; args_text: string };

export type SandboxEvents = {
  batch: (items: HookCall[], ack: number) => void;
  broken: (message: string) => void;
};

export type Compiled = { ok: true } | { ok: false; message: string };

export type Sandbox = {
  compiled: Promise<Compiled>;
  in_flight: () => boolean;
  settle: (id: number, ok: boolean, text: string) => number;
  child: (id: number, source: string, filename: string, name: string, args_text: string) => number;
  terminate: () => Promise<void>;
};

let bundled_code: string | null = null;

const worker_limits = { stackSizeMb: sandbox_stack.worker_mb };

const new_worker = (): Worker => {
  if (import.meta.url.endsWith(".ts")) {
    return new Worker(new URL("./sandbox-worker.ts", import.meta.url), { resourceLimits: worker_limits });
  }
  bundled_code ??= fs.readFileSync(fileURLToPath(new URL("./workflow-sandbox.cjs", import.meta.url)), "utf8");
  return new Worker(bundled_code, { eval: true, resourceLimits: worker_limits });
};

export const open_sandbox = (input: SandboxInput, events: SandboxEvents): Sandbox => {
  const worker = new_worker();
  let seq = 0;
  let answered = 0;
  let closed = false;
  let compiled_done: (value: Compiled) => void = () => undefined;
  const compiled = new Promise<Compiled>((resolve) => {
    compiled_done = resolve;
  });
  const send = (message: HostMessage) => {
    if (!closed) {
      worker.postMessage(message);
    }
  };
  const broken = (message: string) => {
    if (closed) {
      return;
    }
    compiled_done({ ok: false, message });
    events.broken(message);
  };
  worker.on("message", (message: WorkerMessage) => {
    if (closed) {
      return;
    }
    switch (message.type) {
      case "compiled":
        compiled_done({ ok: true });
        return;
      case "compile_failed":
        compiled_done({ ok: false, message: message.message });
        return;
      case "batch":
        answered = message.ack;
        events.batch(message.items, message.ack);
        return;
      case "broken":
        broken(message.message);
    }
  });
  worker.on("error", (error: Error) => {
    console.error(`[workflows] the sandbox of ${input.filename} crashed:`, error);
    broken(`the sandbox crashed: ${error.message}`);
  });
  worker.on("exit", (code: number) => {
    broken(`the sandbox exited with code ${code}`);
  });
  send({ type: "start", source: input.source, filename: input.filename, args_text: input.args_text });
  return {
    compiled,
    in_flight: () => answered !== seq,
    settle: (id, ok, text) => {
      seq += 1;
      send({ type: "settle", seq, id, ok, text });
      return seq;
    },
    child: (id, source, filename, name, args_text) => {
      seq += 1;
      send({ type: "child", seq, id, source, filename, name, args_text });
      return seq;
    },
    terminate: async () => {
      if (closed) {
        return;
      }
      closed = true;
      compiled_done({ ok: false, message: "the workflow was stopped before the script compiled" });
      try {
        await worker.terminate();
      } catch (error) {
        console.error(`[workflows] terminating the sandbox of ${input.filename} failed:`, error);
      }
    },
  };
};

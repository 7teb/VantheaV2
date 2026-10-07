import { Worker } from "node:worker_threads";
import { error_text } from "../storage/coerce.ts";

export class RegexWorkerError extends Error {}

export type RegexSearch = {
  select: (lines: string[], limit: number) => Promise<number[]>;
  timed_out: () => boolean;
  close: () => void;
};

const worker_source = `
const { parentPort, workerData } = require("node:worker_threads");
const pattern = new RegExp(workerData.source, workerData.flags);
parentPort.on("message", ({ lines, limit }) => {
  const hits = [];
  for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
    if (pattern.test(lines[index])) {
      hits.push(index);
    }
  }
  parentPort.postMessage(hits);
});
`;

export const start_regex_search = (pattern: RegExp, budget_ms: number, signal: AbortSignal): RegexSearch => {
  let worker: Worker | null = null;
  let left_ms = budget_ms;
  let expired = false;
  const spawn = () => {
    const created = new Worker(worker_source, { eval: true, workerData: { source: pattern.source, flags: pattern.flags } });
    created.on("error", (error) => console.warn(`[project] the regex worker for ${pattern.source.slice(0, 200)} failed: ${error.message}`));
    return created;
  };
  const close = () => {
    const running = worker;
    worker = null;
    running?.terminate().catch((error: unknown) => console.warn(`[project] stopping the regex worker for ${pattern.source.slice(0, 200)} failed: ${error_text(error)}`));
  };
  const select = (lines: string[], limit: number) =>
    new Promise<number[]>((resolve, reject) => {
      if (expired || !lines.length || limit <= 0) {
        resolve([]);
        return;
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      worker ??= spawn();
      const active = worker;
      const started = Date.now();
      const settle = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", on_abort);
        active.off("message", on_message);
        active.off("error", on_error);
        active.off("exit", on_exit);
        left_ms -= Date.now() - started;
      };
      const on_message = (hits: number[]) => {
        settle();
        resolve(hits);
      };
      const on_error = (error: Error) => {
        settle();
        close();
        reject(new RegexWorkerError(`the regex search worker failed: ${error.message}`));
      };
      const on_exit = (code: number) => {
        settle();
        worker = null;
        reject(new RegexWorkerError(`the regex search worker exited with code ${code}`));
      };
      const on_abort = () => {
        settle();
        close();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        settle();
        close();
        expired = true;
        resolve([]);
      }, Math.max(0, left_ms));
      active.on("message", on_message);
      active.on("error", on_error);
      active.on("exit", on_exit);
      signal.addEventListener("abort", on_abort, { once: true });
      active.postMessage({ lines, limit });
    });
  return { select, timed_out: () => expired, close };
};

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { error_code, error_text } from "./coerce.ts";

export type JsonRead = { status: "ok"; value: unknown } | { status: "missing" } | { status: "corrupt"; error: string };

type FileData = string | Uint8Array;

type Waiter = { resolve: () => void; reject: (error: unknown) => void };

type FileQueue = { running: boolean; active: FileData | null; pending: { data: FileData; waiters: Waiter[] } | null };

const retry_codes = new Set(["EPERM", "EBUSY", "EACCES"]);

const rename_attempts = 8;

const queues = new Map<string, FileQueue>();

const generations = new Map<string, number>();

const temp_path = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

const retry_delay = (attempt: number) => 15 * 2 ** attempt;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const sleep_sync = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const strip_bom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const rename_with_retry = async (from: string, to: string) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      if (!retry_codes.has(error_code(error)) || attempt + 1 >= rename_attempts) {
        throw error;
      }
      await sleep(retry_delay(attempt));
    }
  }
};

const rename_with_retry_sync = (from: string, to: string) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!retry_codes.has(error_code(error)) || attempt + 1 >= rename_attempts) {
        throw error;
      }
      sleep_sync(retry_delay(attempt));
    }
  }
};

const write_once = async (file: string, data: FileData) => {
  const generation = generations.get(file) ?? 0;
  const temp = temp_path(file);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.writeFile(temp, data);
    if ((generations.get(file) ?? 0) !== generation) {
      await fsp.rm(temp, { force: true });
      return;
    }
    await rename_with_retry(temp, file);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
};

const drain = async (file: string, queue: FileQueue) => {
  queue.running = true;
  while (queue.pending) {
    const job = queue.pending;
    queue.pending = null;
    queue.active = job.data;
    try {
      await write_once(file, job.data);
      for (const waiter of job.waiters) {
        waiter.resolve();
      }
    } catch (error) {
      for (const waiter of job.waiters) {
        waiter.reject(new Error(`writing ${file} failed: ${error_text(error)}`, { cause: error }));
      }
    }
  }
  queue.running = false;
  queue.active = null;
  queues.delete(file);
};

export const write_file_atomic = (file: string, data: FileData): Promise<void> =>
  new Promise((resolve, reject) => {
    const queue = queues.get(file) ?? { running: false, active: null, pending: null };
    queues.set(file, queue);
    if (queue.pending) {
      queue.pending.data = data;
      queue.pending.waiters.push({ resolve, reject });
    } else {
      queue.pending = { data, waiters: [{ resolve, reject }] };
    }
    if (!queue.running) {
      void drain(file, queue);
    }
  });

export const write_json = (file: string, value: unknown): Promise<void> => write_file_atomic(file, JSON.stringify(value, null, 2));

export const write_file_atomic_sync = (file: string, data: FileData) => {
  generations.set(file, (generations.get(file) ?? 0) + 1);
  const queue = queues.get(file);
  const superseded = queue?.pending?.waiters ?? [];
  if (queue) {
    queue.pending = null;
    queue.active = null;
  }
  const temp = temp_path(file);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, data);
    rename_with_retry_sync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    for (const waiter of superseded) {
      waiter.reject(error);
    }
    throw error;
  }
  for (const waiter of superseded) {
    waiter.resolve();
  }
};

export const write_json_sync = (file: string, value: unknown) => write_file_atomic_sync(file, JSON.stringify(value, null, 2));

export const flush_pending_sync = () => {
  for (const [file, queue] of [...queues]) {
    const data = queue.pending?.data ?? queue.active;
    if (data === null) {
      continue;
    }
    try {
      write_file_atomic_sync(file, data);
    } catch (error) {
      console.error(`[storage] flushing ${file} on quit failed:`, error);
    }
  }
};

export const read_json = async (file: string): Promise<JsonRead> => {
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return { status: "missing" };
    }
    throw error;
  }
  try {
    return { status: "ok", value: JSON.parse(strip_bom(raw)) };
  } catch (error) {
    return { status: "corrupt", error: error_text(error) };
  }
};

export const keep_corrupt = async (file: string): Promise<string> => {
  const target = `${file}.corrupt-${Date.now()}`;
  await fsp.copyFile(file, target);
  return target;
};

export const sweep_tmp = async (dirs: string[]): Promise<number> => {
  let removed = 0;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch (error) {
      if (error_code(error) === "ENOENT") {
        continue;
      }
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith(".tmp")) {
        continue;
      }
      await fsp.rm(path.join(dir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
};

import fs from "node:fs/promises";
import path from "node:path";
import { error_code, missing_path } from "../storage/coerce.ts";
import { kept_cache, read_cache, write_cache } from "./cache.ts";
import { recorded_dir, type ChatPaths } from "./paths.ts";
import * as queue from "./queue.ts";
import { read_turns, write_turns, type TurnsFile } from "./records.ts";
import { announce, current_deps, inactive, paths_of } from "./state.ts";

const object_folder = /^[0-9a-f]{2}$/;

const names_in = async (dir: string): Promise<string[]> => {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (missing_path(error)) return [];
    throw error;
  }
};

const link_or_copy = async (from: string, to: string): Promise<void> => {
  try {
    await fs.link(from, to);
  } catch (error) {
    if (error_code(error) === "EEXIST") return;
    await fs.copyFile(from, to);
  }
};

const link_objects = async (from: string, to: string): Promise<void> => {
  for (const folder of await names_in(from)) {
    if (!object_folder.test(folder)) continue;
    await fs.mkdir(path.join(to, folder), { recursive: true });
    for (const name of await names_in(path.join(from, folder))) {
      await link_or_copy(path.join(from, folder, name), path.join(to, folder, name));
    }
  }
};

const copy_recorded = async (source: ChatPaths, target: ChatPaths, message_id: string): Promise<void> => {
  try {
    await fs.cp(recorded_dir(source, message_id), recorded_dir(target, message_id), { recursive: true });
  } catch (error) {
    if (!missing_path(error)) throw error;
  }
};

const fork_job = async (source_id: string, fork_id: string, signal: AbortSignal): Promise<void> => {
  await queue.tail(source_id);
  signal.throwIfAborted();
  const messages = await current_deps().messages(fork_id);
  if (!messages) return;
  const ids = new Set(messages.map((message) => message.id));
  const source = paths_of(source_id);
  const target = paths_of(fork_id);
  const stored = await read_turns(source, source_id);
  const copied: TurnsFile = { version: 1, index_repo: null, turns: stored.turns.filter((record) => ids.has(record.message_id)).map((record) => ({ ...record, closed: true })) };
  if (!copied.turns.length) return;
  await fs.mkdir(target.dir, { recursive: true });
  for (const record of copied.turns) {
    if (record.mode === "recorded") await copy_recorded(source, target, record.message_id);
  }
  await link_objects(source.objects, target.objects);
  await write_cache(target, kept_cache(await read_cache(source, source_id), copied));
  await write_turns(target, copied);
  announce(fork_id);
};

export const fork = (source_id: string, fork_id: string): void => {
  if (inactive(source_id) || inactive(fork_id)) return;
  void queue.run(fork_id, "copy from the forked chat", (signal) => fork_job(source_id, fork_id, signal));
};

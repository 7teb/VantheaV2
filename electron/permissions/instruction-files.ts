import fs from "node:fs/promises";
import path from "node:path";
import { instruction_fallback } from "../chats/workspace.ts";
import { line_diff } from "../project/diff.ts";
import { instruction_dirs } from "../prompts/project.ts";
import { error_code } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { decode_text } from "../storage/text-codec.ts";
import { human_requests_of, type HumanRequest } from "./context.ts";
import { stat_optional } from "./source-read.ts";

const instruction_names = ["AGENTS.md", "CLAUDE.md"] as const;

export type InstructionFile = { name: string; dir: string; text: string | null; size: number; mtime: number };

export type InstructionSnapshot = { anchor: string | null; number: number; after_restart: boolean; files: InstructionFile[] };

export type AgentEdits = { text: string; files: string[] };

const snapshots = new Map<string, InstructionSnapshot & { root: string }>();

const process_started = Date.now();

export const is_instruction_file = (relative: string): boolean => instruction_names.some((name) => path_key(name) === path_key(relative));

const read_file = async (dir: string, name: string): Promise<InstructionFile | null> => {
  const file = path.join(dir, name);
  try {
    const [stat, bytes] = await Promise.all([fs.stat(file), fs.readFile(file)]);
    return { name, dir, text: decode_text(bytes).text, size: stat.size, mtime: stat.mtimeMs };
  } catch (error) {
    if (error_code(error) === "ENOENT") {
      return null;
    }
    console.warn(`[permissions] reading ${file} for the instruction snapshot failed: ${error_code(error) || String(error)}`);
    return { name, dir, text: null, size: -1, mtime: -1 };
  }
};

const resolve_file = async (dirs: string[], name: string): Promise<InstructionFile> => {
  for (const dir of dirs) {
    const file = await read_file(dir, name);
    if (file) {
      return file;
    }
  }
  return { name, dir: dirs[0] ?? "", text: null, size: -1, mtime: -1 };
};

const current_stat = async (dirs: string[], name: string): Promise<{ dir: string; size: number; mtime: number }> => {
  for (const dir of dirs) {
    const stat = await stat_optional(path.join(dir, name), "agent edits");
    if (stat) {
      return { dir, size: stat.size, mtime: stat.mtimeMs };
    }
  }
  return { dir: dirs[0] ?? "", size: -1, mtime: -1 };
};

export const instruction_snapshot = async (chat_id: string, root: string, humans: HumanRequest[]): Promise<InstructionSnapshot> => {
  const anchor = humans.at(-1) ?? null;
  const existing = snapshots.get(chat_id);
  if (existing && existing.anchor === (anchor?.id ?? null)) {
    return existing;
  }
  const dirs = root ? instruction_dirs(root, await instruction_fallback(chat_id)) : [];
  const files = root ? await Promise.all(instruction_names.map((name) => resolve_file(dirs, name))) : [];
  const snapshot = {
    anchor: anchor?.id ?? null,
    number: humans.length,
    after_restart: !existing && anchor !== null && anchor.at < process_started,
    files,
    root,
  };
  snapshots.set(chat_id, snapshot);
  return snapshot;
};

export const refresh_instruction_snapshot = async (chat_id: string): Promise<void> => {
  const existing = snapshots.get(chat_id);
  if (existing) {
    await instruction_snapshot(chat_id, existing.root, human_requests_of(chat_id));
  }
};

const diff_text = (before: string | null, after: string | null): string =>
  line_diff(before, after)
    .lines.map((line) => (line.kind === "gap" ? "@@" : `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}${line.text}`))
    .join("\n");

export const agent_edits = async (chat_id: string, root: string): Promise<AgentEdits> => {
  const snapshot = snapshots.get(chat_id);
  if (!snapshot || !root) {
    return { text: "", files: [] };
  }
  const dirs = instruction_dirs(root, await instruction_fallback(chat_id));
  const blocks: string[] = [];
  const changed: string[] = [];
  for (const before of snapshot.files) {
    const current = await current_stat(dirs, before.name);
    if (current.dir === before.dir && current.size === before.size && current.mtime === before.mtime) {
      continue;
    }
    const after = await resolve_file(dirs, before.name);
    if (after.text === before.text) {
      continue;
    }
    changed.push(before.name);
    const state = before.text === null ? " (created)" : after.text === null ? " (deleted)" : "";
    blocks.push(`--- ${before.name}${state}\n${diff_text(before.text, after.text)}`);
  }
  return { text: blocks.join("\n"), files: changed };
};

export const forget_instruction_files = (chat_id: string): void => {
  snapshots.delete(chat_id);
};

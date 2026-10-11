import fs from "node:fs/promises";
import path from "node:path";
import { line_diff } from "../project/diff.ts";
import { error_code } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { decode_text } from "../storage/text-codec.ts";
import { human_requests_of, type HumanRequest } from "./context.ts";
import { stat_optional } from "./source-read.ts";

const instruction_names = ["AGENTS.md", "CLAUDE.md"] as const;

export type InstructionFile = { name: string; text: string | null; size: number; mtime: number };

export type InstructionSnapshot = { anchor: string | null; number: number; after_restart: boolean; files: InstructionFile[] };

export type AgentEdits = { text: string; files: string[] };

const snapshots = new Map<string, InstructionSnapshot & { root: string }>();

const process_started = Date.now();

export const is_instruction_file = (relative: string): boolean => instruction_names.some((name) => path_key(name) === path_key(relative));

const read_file = async (root: string, name: string): Promise<InstructionFile> => {
  const file = path.join(root, name);
  try {
    const [stat, bytes] = await Promise.all([fs.stat(file), fs.readFile(file)]);
    return { name, text: decode_text(bytes).text, size: stat.size, mtime: stat.mtimeMs };
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      console.warn(`[permissions] reading ${file} for the instruction snapshot failed: ${error_code(error) || String(error)}`);
    }
    return { name, text: null, size: -1, mtime: -1 };
  }
};

export const instruction_snapshot = async (chat_id: string, root: string, humans: HumanRequest[]): Promise<InstructionSnapshot> => {
  const anchor = humans.at(-1) ?? null;
  const existing = snapshots.get(chat_id);
  if (existing && existing.anchor === (anchor?.id ?? null)) {
    return existing;
  }
  const files = root ? await Promise.all(instruction_names.map((name) => read_file(root, name))) : [];
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
  const blocks: string[] = [];
  const changed: string[] = [];
  for (const before of snapshot.files) {
    const stat = await stat_optional(path.join(root, before.name), "agent edits");
    const size = stat?.size ?? -1;
    const mtime = stat?.mtimeMs ?? -1;
    if (size === before.size && mtime === before.mtime) {
      continue;
    }
    const after = await read_file(root, before.name);
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

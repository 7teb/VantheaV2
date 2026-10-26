import { path_key } from "../storage/paths.ts";

export type WriteEntry = { actor: string; tool: string; call_id: string; at: number; sha256: string; prior_birthtime: number | null };

export type ChangeMark = { kind: "written"; actor: string; tool: string; at: number; same_bytes: boolean; before_chat: boolean } | { kind: "created"; at: number } | { kind: "modified"; at: number };

export type FileTimes = { mtime: number; birthtime: number };

const ledger = new Map<string, Map<string, WriteEntry>>();

export const record_write = (chat_id: string, file: string, entry: WriteEntry): void => {
  const writes = ledger.get(chat_id) ?? new Map<string, WriteEntry>();
  const key = path_key(file);
  const first = writes.get(key);
  writes.set(key, first ? { ...entry, prior_birthtime: first.prior_birthtime } : entry);
  ledger.set(chat_id, writes);
};

export const write_entry = (chat_id: string, file: string): WriteEntry | null => ledger.get(chat_id)?.get(path_key(file)) ?? null;

export const chat_written = (chat_id: string): string[] => [...(ledger.get(chat_id)?.keys() ?? [])];

export const forget_chat_writes = (chat_id: string): void => {
  ledger.delete(chat_id);
};

export const change_mark = (chat_id: string, since: number, file: string, sha256: string | null, times: FileTimes): ChangeMark | null => {
  const entry = write_entry(chat_id, file);
  if (entry) {
    const before_chat = entry.prior_birthtime !== null && entry.prior_birthtime < since;
    return { kind: "written", actor: entry.actor, tool: entry.tool, at: entry.at, same_bytes: entry.sha256 === sha256, before_chat };
  }
  if (times.birthtime >= since) return { kind: "created", at: times.birthtime };
  return times.mtime >= since ? { kind: "modified", at: times.mtime } : null;
};

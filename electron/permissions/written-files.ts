import { path_key } from "../storage/paths.ts";

export type WriteEntry = { actor: string; tool: string; call_id: string; at: number; sha256: string };

export type ChangeMark = { kind: "written"; actor: string; tool: string; at: number; same_bytes: boolean } | { kind: "modified"; at: number };

const ledger = new Map<string, Map<string, WriteEntry>>();

export const record_write = (chat_id: string, file: string, entry: WriteEntry): void => {
  const writes = ledger.get(chat_id) ?? new Map<string, WriteEntry>();
  writes.set(path_key(file), entry);
  ledger.set(chat_id, writes);
};

export const write_entry = (chat_id: string, file: string): WriteEntry | null => ledger.get(chat_id)?.get(path_key(file)) ?? null;

export const chat_written = (chat_id: string): string[] => [...(ledger.get(chat_id)?.keys() ?? [])];

export const forget_chat_writes = (chat_id: string): void => {
  ledger.delete(chat_id);
};

export const change_mark = (chat_id: string, since: number, file: string, sha256: string | null, mtime: number): ChangeMark | null => {
  const entry = write_entry(chat_id, file);
  if (entry) {
    return { kind: "written", actor: entry.actor, tool: entry.tool, at: entry.at, same_bytes: entry.sha256 === sha256 };
  }
  return mtime >= since ? { kind: "modified", at: mtime } : null;
};

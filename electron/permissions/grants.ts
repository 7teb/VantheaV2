import path from "node:path";
import type { GrantScope } from "../../shared/approval.ts";
import { path_key } from "../storage/paths.ts";
import { split_statements } from "./statements.ts";

export type GrantContext = { authorization_hash: string; cwd: string; source_hash: string; command_hash: string };
export type GrantRecord = { chat_id: string; project_root: string; scope: GrantScope; prefix: string | null; context?: GrantContext };
export type GrantQuery = { chat_id: string; project_root: string; command: string; context?: GrantContext };
const records: GrantRecord[] = [];
const command_word = /^[\w.\\/-]+$/;
const argument_word = /^[\w][\w.:\\/-]*$/;
const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const root_key = (project_root: string) => path_key(path.resolve(project_root));
const statement_matches = (statement: string, prefix: string) => {
  const normalized = normalize(statement);
  return normalized === prefix || normalized.startsWith(prefix + " ");
};

export const suggest_prefix = (command: string): string | null => {
  const statements = split_statements(command);
  const words = (statements[0] ?? "").trim().split(/\s+/);
  const first = words[0] ?? "";
  if (!command_word.test(first)) return null;
  const second = words[1] ?? "";
  const prefix = argument_word.test(second) ? first + " " + second : first;
  return statements.every(statement => statement_matches(statement, normalize(prefix))) ? prefix : null;
};

const matches = (record: GrantRecord, query: GrantQuery): boolean => {
  if (record.scope === "session") {
    if (!query.project_root || root_key(record.project_root) !== root_key(query.project_root)) return false;
  } else if (record.chat_id !== query.chat_id || root_key(record.project_root) !== root_key(query.project_root)) {
    return false;
  }
  if (record.scope !== "prefix") return true;
  const statements = split_statements(query.command);
  return Boolean(record.prefix && statements.length && statements.every(statement => statement_matches(statement, normalize(record.prefix!))));
};

const same_environment = (a: GrantContext, b: GrantContext) =>
  path_key(a.cwd) === path_key(b.cwd) && a.source_hash === b.source_hash;

export const grant_covers = (query: GrantQuery): boolean => {
  const eligible = records.filter(record => matches(record, query));
  if (!query.context) {
    if (eligible.some(record => !record.context && record.scope !== "prefix")) return true;
    const parts = split_statements(query.command);
    const legacy = records.filter(record => !record.context && record.scope === "prefix" && record.chat_id === query.chat_id && root_key(record.project_root) === root_key(query.project_root));
    return parts.length > 0 && parts.every(part => legacy.some(record => record.prefix && statement_matches(part, normalize(record.prefix))));
  }
  return eligible.some(record => record.context && same_environment(record.context, query.context!) &&
    record.context.authorization_hash === query.context!.authorization_hash &&
    record.context.command_hash === query.context!.command_hash);
};

export const grant_hint = (query: GrantQuery): string => {
  if (!query.context) return "";
  return records.filter(record => matches(record, query) && record.context && same_environment(record.context, query.context!))
    .map(record => (record.context!.authorization_hash === query.context!.authorization_hash
      ? "Human UI approval after the current instructions: "
      : "Earlier human UI approval, subject to all later restrictions: ") +
      (record.scope === "prefix" ? "commands starting with " + record.prefix : record.scope + " command approval") +
      ". Working directory and inspected source are unchanged.").join("\n");
};

export const record_grant = (grant: GrantRecord): void => {
  if (grant.scope === "once" || (grant.scope === "prefix" && !grant.prefix) || (grant.scope === "session" && !grant.project_root.trim())) return;
  records.push(grant);
  if (records.length > 256) records.shift();
};

export const clear_chat_grants = (chat_id: string): void => {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].chat_id === chat_id && records[index].scope !== "session") records.splice(index, 1);
  }
};

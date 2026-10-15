import { read_only_command } from "./allowlist.ts";
import { deletes } from "./floor.ts";
import { split_statements, type Dialect } from "./statements.ts";

export type PrefixGrant = { prefix: string; example: string };

const command_word = /^[\w.\\/-]+$/;

const argument_word = /^[\w][\w.:\\/-]*$/;

const process_kill = /^(?:stop-process|spps|kill|taskkill|pkill|killall)(?:\.exe)?(?=\s|$)/i;

const posix_removal = /(?:^|[\s;(&{|])(?:unlink|shred|xargs)(?=\s|$)|(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?=\s|$)/;

const flag_word = /^(?:--?[a-z?]|\/[a-z?]{1,3}$)/i;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const statement_matches = (statement: string, prefix: string) => {
  const normalized = normalize(statement);
  return normalized === prefix || normalized.startsWith(`${prefix} `);
};

const flags_of = (statement: string): Set<string> =>
  new Set(
    normalize(statement)
      .split(" ")
      .filter((word) => flag_word.test(word))
      .map((word) => word.split(/[=:]/)[0] ?? word),
  );

const never_granted = (dialect: Dialect) => (statement: string) =>
  deletes(statement) || process_kill.test(statement.trim()) || (dialect === "posix" && posix_removal.test(statement));

const acting_statements = (command: string, dialect: Dialect): string[] => {
  const statements = split_statements(command, dialect);
  const acting = statements.filter((statement) => !read_only_command(statement, dialect));
  return acting.length ? acting : statements;
};

export const suggest_prefix = (command: string, dialect: Dialect = "powershell"): string | null => {
  const statements = acting_statements(command, dialect);
  const first = statements[0];
  if (!first || statements.some(never_granted(dialect))) {
    return null;
  }
  const words = first.trim().split(/\s+/);
  const head = words[0] ?? "";
  if (!command_word.test(head)) {
    return null;
  }
  const second = words[1];
  if (second !== undefined && !argument_word.test(second)) {
    return null;
  }
  const prefix = second === undefined ? head : `${head} ${second}`;
  return statements.every((statement) => statement_matches(statement, normalize(prefix))) ? prefix : null;
};

const covered_by = (statement: string, grant: PrefixGrant, dialect: Dialect): boolean => {
  const prefix = normalize(grant.prefix);
  if (!prefix || !statement_matches(statement, prefix)) {
    return false;
  }
  const example = acting_statements(grant.example, dialect).find((entry) => statement_matches(entry, prefix)) ?? "";
  const allowed = flags_of(example);
  return [...flags_of(statement)].every((flag) => allowed.has(flag));
};

export const covering_prefixes = (command: string, grants: PrefixGrant[], dialect: Dialect = "powershell"): string[] => {
  const statements = acting_statements(command, dialect);
  if (!statements.length || !grants.length) {
    return [];
  }
  const blocked = never_granted(dialect);
  const used: string[] = [];
  for (const statement of statements) {
    const grant = blocked(statement) ? undefined : grants.find((entry) => covered_by(statement, entry, dialect));
    if (!grant) {
      return [];
    }
    if (!used.includes(grant.prefix)) {
      used.push(grant.prefix);
    }
  }
  return used;
};

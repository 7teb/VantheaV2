import { allowed_in_auto } from "./allowlist.ts";
import { deletes } from "./floor.ts";
import { split_statements } from "./statements.ts";

export type PrefixGrant = { prefix: string; example: string };

const command_word = /^[\w.\\/-]+$/;

const argument_word = /^[\w][\w.:\\/-]*$/;

const process_kill = /^(?:stop-process|spps|kill|taskkill)(?:\.exe)?(?=\s|$)/i;

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

const never_granted = (statement: string) => deletes(statement) || process_kill.test(statement.trim());

const acting_statements = (command: string): string[] => {
  const statements = split_statements(command);
  const acting = statements.filter((statement) => !allowed_in_auto(statement));
  return acting.length ? acting : statements;
};

export const suggest_prefix = (command: string): string | null => {
  const statements = acting_statements(command);
  const first = statements[0];
  if (!first || statements.some(never_granted)) {
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

const covered_by = (statement: string, grant: PrefixGrant): boolean => {
  const prefix = normalize(grant.prefix);
  if (!prefix || !statement_matches(statement, prefix)) {
    return false;
  }
  const example = acting_statements(grant.example).find((entry) => statement_matches(entry, prefix)) ?? "";
  const allowed = flags_of(example);
  return [...flags_of(statement)].every((flag) => allowed.has(flag));
};

export const grant_covers = (command: string, grants: PrefixGrant[]): boolean => {
  const statements = acting_statements(command);
  if (!statements.length || !grants.length) {
    return false;
  }
  return statements.every((statement) => !never_granted(statement) && grants.some((grant) => covered_by(statement, grant)));
};

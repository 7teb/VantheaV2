import { split_statements } from "./statements.ts";

const read_commands =
  /^(?:rg|where(?:\.exe)?|findstr|git\s+(?:status|diff|log|show|branch|rev-parse|ls-files|blame)|get-childitem|gci|dir|ls|get-content|gc|cat|type|select-string|sls|get-item|gi|test-path|resolve-path|get-location|pwd|select-object|sort-object|measure-object|format-table|format-list|out-string|get-filehash|get-command)(?=\s|$)/i;

const unsafe_fragments =
  /(>|\b(?:out-file|set-content|add-content|tee-object|new-item|copy-item|move-item|rename-item|remove-item|start-process|invoke-expression|iex|invoke-command|invoke-webrequest|iwr|invoke-restmethod|irm|encodedcommand|frombase64string|set-location|push-location|cmd|powershell|pwsh)\b|\b(?:git\s+(?:-c|--exec-path|config)\b)|--output\b|--pre\b|--ext-diff\b|--textconv\b)/i;

const branch_listing_flags = new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current", "--verbose", "--no-color", "--color"]);

const git_branch_lists_only = (statement: string) => {
  const match = /^git\s+branch\b([\s\S]*)$/i.exec(statement.trim());
  if (!match) {
    return true;
  }
  return (match[1] ?? "").split(/\s+/).filter(Boolean).every((arg) => branch_listing_flags.has(arg.toLowerCase()));
};

const statement_is_read = (statement: string) =>
  read_commands.test(statement.trim()) && !unsafe_fragments.test(statement) && git_branch_lists_only(statement);

export const allowed_in_auto = (command: string): boolean => {
  const statements = split_statements(String(command || ""));
  return statements.length > 0 && statements.every(statement_is_read);
};

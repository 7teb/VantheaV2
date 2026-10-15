import { split_statements, type Dialect } from "./statements.ts";

const read_commands =
  /^(?:rg|where(?:\.exe)?|findstr|git\s+(?:status|diff|log|show|branch|rev-parse|ls-files|blame)|get-childitem|gci|dir|ls|get-content|gc|cat|type|select-string|sls|get-item|gi|test-path|resolve-path|get-location|pwd|select-object|sort-object|measure-object|format-table|format-list|out-string|get-filehash|get-command|get-process|gps|get-service|get-date|group-object|convertfrom-json|get-nettcpconnection)(?=\s|$)/i;

const exact_reads = /^(?:git\s+remote(?:\s+-v)?|git\s+stash\s+list|git\s+tag(?:\s+(?:-l|--list)(?:\s+[\w.*/-]+)?)?)$/i;

const quiet_errors = /\s*(?:2>\s*\$null|2>&1|\*>\s*\$null|2>\s*nul)(?=\s|$)/gi;

const unsafe_fragments =
  /(>|\b(?:out-file|set-content|add-content|tee-object|new-item|copy-item|move-item|rename-item|remove-item|start-process|invoke-expression|invoke-command|invoke-webrequest|invoke-restmethod|encodedcommand|frombase64string|set-location|push-location)\b|(?<![.\\/*-])\b(?:cmd|powershell|pwsh|iex|irm|iwr)\b(?![\\/-]|\.(?!exe\b))|\b(?:git\s+(?:-c|--exec-path|config)\b)|--output\b|--pre\b|--ext-diff\b|--textconv\b|--hostname-bin\b)/i;

const posix_reads =
  /^(?:rg|grep|egrep|fgrep|cat|head|tail|ls|dir|find|wc|cut|sort|diff|cmp|stat|file|du|df|pwd|which|type|realpath|readlink|basename|dirname|md5sum|sha1sum|sha256sum|sha512sum|date|whoami|uname|ps|jq|git\s+(?:status|diff|log|show|branch|rev-parse|ls-files|blame))(?=\s|$)/;

const posix_quiet = /\s*(?:[12&]?>\s*\/dev\/null|2>&1)(?=\s|$)/g;

const posix_unsafe =
  /(>|<\(|(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)(?=\s|$)|^sort\b.*\s(?:-[a-zA-Z]*o|--o|--co)|^file\b.*\s(?:-[a-zA-Z0-9]*C|--co)|^date\b.*\s(?:-[uR]*s|--s)|\bgit\s+(?:-c|--exec-path|config)\b|--output\b|--pre\b|--ext-diff\b|--textconv\b|--hostname-bin\b)/;

const posix_runner =
  /(?:^|[|;&({`]|\$\()\s*(?:(?:command|env|nohup|exec|time|nice|timeout|stdbuf|setsid)\s+(?:\S+\s+)*?)?(?:tee|xargs|eval|exec|source|bash|sh|dash|cmd|powershell|pwsh)(?=[\s;|&)`]|$)/;

const branch_listing_flags = new Set(["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current", "--verbose", "--no-color", "--color"]);

const git_branch_lists_only = (statement: string) => {
  const match = /^git\s+branch\b([\s\S]*)$/i.exec(statement.trim());
  if (!match) {
    return true;
  }
  return (match[1] ?? "").split(/\s+/).filter(Boolean).every((arg) => branch_listing_flags.has(arg.toLowerCase()));
};

const statement_is_read = (statement: string) => {
  const quiet = statement.replace(quiet_errors, "").trim();
  return exact_reads.test(quiet) || (read_commands.test(quiet) && !unsafe_fragments.test(quiet) && git_branch_lists_only(quiet));
};

const posix_statement_is_read = (statement: string) => {
  const quiet = statement.replace(posix_quiet, "").trim();
  return exact_reads.test(quiet) || (posix_reads.test(quiet) && !posix_unsafe.test(quiet) && !posix_runner.test(quiet) && git_branch_lists_only(quiet));
};

export const read_only_command = (command: string, dialect: Dialect = "powershell"): boolean => {
  const statements = split_statements(String(command || ""), dialect);
  const is_read = dialect === "posix" ? posix_statement_is_read : statement_is_read;
  return statements.length > 0 && statements.every(is_read);
};

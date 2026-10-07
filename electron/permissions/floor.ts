import { split_pipelines, split_statements } from "./statements.ts";

const delete_verb = /(?:^|[\s;(&{|])(?:remove-item|ri|rm|rmdir|rd|del|erase)(?=\s|$)/i;

const dotnet_delete = /\[(?:system\.)?io\.(?:directory|file)\]::delete\s*\(/i;

const system_path =
  /(%systemroot%|%windir%|\$env:systemroot|\$env:windir|[a-z]:\\windows\b|\\system32\b|[a-z]:\\program files|[\\/]boot[\\/]|[a-z]:[\\/](?=["'*\s)]|$))/i;

const assignment = /^\s*\$([a-z_][\w:]*)\s*=\s*([\s\S]+)$/i;

const variable_use = /\$([a-z_][\w:]*)/gi;

const joined_literal = (text: string) => text.replace(/["']\s*\+\s*["']/g, "").replace(/["']/g, "");

const deletes = (statement: string) => delete_verb.test(statement) || dotnet_delete.test(statement);

const touches_system_path = (statement: string) => system_path.test(statement) || system_path.test(joined_literal(statement));

const statement_reason = (statement: string, system_variables: Set<string>): string => {
  if (/(?:^|\s)(diskpart|bcdedit)(?:\.exe)?(?=\s|$)/i.test(statement)) {
    return "diskpart / bcdedit can wipe partitions or break the boot configuration";
  }
  if (/\b(clear-disk|format-volume|initialize-disk|reset-physicaldisk)\b/i.test(statement)) {
    return "a disk-wiping cmdlet (Clear-Disk / Format-Volume / Initialize-Disk / Reset-PhysicalDisk)";
  }
  if (/(?:^|\s)format(?:\.com)?\s+(?:\/\S+\s+)*[a-z]:/i.test(statement)) {
    return "formatting a drive";
  }
  if (/\bvssadmin(?:\.exe)?\s+delete\s+shadows\b/i.test(statement) || /\bwmic(?:\.exe)?\s+shadowcopy\s+delete\b/i.test(statement)) {
    return "deleting volume shadow copies";
  }
  if (/\bcipher(?:\.exe)?\s+\/w\b/i.test(statement)) {
    return "wiping free disk space with cipher /w";
  }
  if (!deletes(statement) && !/\breg(?:\.exe)?\s+delete\b/i.test(statement)) {
    return "";
  }
  if (deletes(statement) && touches_system_path(statement)) {
    return "deleting Windows / System32 / Program Files / a drive root / boot files";
  }
  if (deletes(statement) && [...statement.matchAll(variable_use)].some((match) => system_variables.has((match[1] ?? "").toLowerCase()))) {
    return "deleting a system path held in a variable";
  }
  if (/\breg(?:\.exe)?\s+delete\b/i.test(statement) && /\b(hklm|hkey_local_machine)\b/i.test(statement)) {
    return "deleting HKEY_LOCAL_MACHINE registry keys";
  }
  if (deletes(statement) && /\bhklm:/i.test(statement)) {
    return "deleting HKEY_LOCAL_MACHINE registry keys";
  }
  return "";
};

const system_path_variables = (statements: string[]) => {
  const names = new Set<string>();
  for (const statement of statements) {
    const match = assignment.exec(statement);
    if (match && touches_system_path(match[2] ?? "")) {
      names.add((match[1] ?? "").toLowerCase());
    }
  }
  return names;
};

export const floor_reason = (command: string): string => {
  const statements = split_statements(String(command || ""));
  const system_variables = system_path_variables(statements);
  for (const statement of statements) {
    const reason = statement_reason(statement, system_variables);
    if (reason) {
      return reason;
    }
  }
  const piped_delete = split_pipelines(String(command || "")).some(
    (pipeline) => pipeline.includes("|") && deletes(pipeline) && touches_system_path(pipeline),
  );
  return piped_delete ? "deleting Windows / System32 / Program Files / a drive root / boot files through a pipeline" : "";
};

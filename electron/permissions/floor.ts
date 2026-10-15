import path from "node:path";
import {
  app_reason,
  cipher_reason,
  format_reason,
  hits_app,
  hklm_reason,
  in_project,
  is_system_path,
  partition_reason,
  shadow_reason,
  system_delete_reason,
  system_variable_reason,
  type FloorScope,
} from "./floor-shared.ts";
import { posix_floor_reason } from "./floor-posix.ts";
import { shell_words, type Piece, type Word } from "./shell-words.ts";
import { quote_of, split_pipelines, split_statements, statement_parts, type Dialect, type StatementElement } from "./statements.ts";

export type { FloorScope } from "./floor-shared.ts";

const delete_names = "remove-item|ri|rm|rmdir|rd|del|erase";

const delete_verb = new RegExp(String.raw`(?:^|[\s;(&{|])(?:${delete_names})(?=\s|$)`, "i");

const removal_verb = new RegExp(`^(?:${delete_names}|move-item|mi|mv|move|rename-item|rni|ren)$`, "i");

const listing_verb = /^(?:get-childitem|gci|ls|dir|get-item|gi)$/i;

const pass_through_verb = /^(?:where-object|where|\?|select-object|select|sort-object|sort)$/i;

const each_verb = /^(?:foreach-object|%|foreach)$/i;

const pipeline_item = /\$(?:_|psitem)\b/i;

const loop_header = /^\s*\$([a-z_]\w*)\s+in\s+([\s\S]+)$/i;

const lone_variable = /^\$(?:\{[^}]+\}|[a-z_][\w:]*)$/i;

const location_verb = /^(?:cd|chdir|set-location|sl|push-location|pushd)$/i;

const app_path = /(?:%appdata%|\$env:appdata|\$\{env:appdata\}|\$\(\s*(?:\$env:appdata|\$\{env:appdata\})\s*\)|appdata[\\/]roaming)[\\/]vantheax/i;

const dotnet_delete = /\[(?:system\.)?io\.(?:directory|file)\]::delete\s*\(/i;

const assignment = /^\s*\$([a-z_][\w:]*)\s*=\s*([\s\S]+)$/i;

const variable_use = /\$([a-z_][\w:]*)/gi;

const joined_literal = (text: string) => text.replace(/["']\s*\+\s*["']/g, "").replace(/["']/g, "");

export const deletes = (statement: string) => delete_verb.test(statement) || dotnet_delete.test(statement);

const touches_system_path = (statement: string) => is_system_path(statement) || is_system_path(joined_literal(statement));

const statement_reason = (statement: string, system_variables: Set<string>): string => {
  if (/(?:^|\s)(diskpart|bcdedit)(?:\.exe)?(?=\s|$)/i.test(statement)) {
    return partition_reason;
  }
  if (/\b(clear-disk|format-volume|initialize-disk|reset-physicaldisk)\b/i.test(statement)) {
    return "a disk-wiping cmdlet (Clear-Disk / Format-Volume / Initialize-Disk / Reset-PhysicalDisk)";
  }
  if (/(?:^|\s)format(?:\.com)?\s+(?:\/\S+\s+)*[a-z]:/i.test(statement)) {
    return format_reason;
  }
  if (/\bvssadmin(?:\.exe)?\s+delete\s+shadows\b/i.test(statement) || /\bwmic(?:\.exe)?\s+shadowcopy\s+delete\b/i.test(statement)) {
    return shadow_reason;
  }
  if (/\bcipher(?:\.exe)?\s+\/w\b/i.test(statement)) {
    return cipher_reason;
  }
  if (!deletes(statement) && !/\breg(?:\.exe)?\s+delete\b/i.test(statement)) {
    return "";
  }
  if (deletes(statement) && touches_system_path(statement)) {
    return system_delete_reason;
  }
  if (deletes(statement) && [...statement.matchAll(variable_use)].some((match) => system_variables.has((match[1] ?? "").toLowerCase()))) {
    return system_variable_reason;
  }
  if (/\breg(?:\.exe)?\s+delete\b/i.test(statement) && /\b(hklm|hkey_local_machine)\b/i.test(statement)) {
    return hklm_reason;
  }
  if (deletes(statement) && /\bhklm:/i.test(statement)) {
    return hklm_reason;
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

type Walk = { scope: FloorScope; location: string | null; variables: Map<string, string>; app_variables: Set<string> };

type Command = { text: string; verb: string; words: Word[]; args: Word[] };

const mentions_app = (text: string) => app_path.test(text) || app_path.test(joined_literal(text));

const env_value = (name: string): string | null => process.env[name] || null;

const expansions: [RegExp, string][] = [
  [/%appdata%|\$\{env:appdata\}|\$env:appdata\b/gi, "APPDATA"],
  [/%userprofile%|\$\{env:userprofile\}|\$env:userprofile\b|\$\{home\}|\$home\b/gi, "USERPROFILE"],
];

const expand = (token: string, variables: Map<string, string>): string | null => {
  const home = env_value("USERPROFILE");
  let value = home ? token.replace(/^~(?=$|[\\/])/, home) : token;
  for (const [pattern, name] of expansions) {
    const real = env_value(name);
    value = real ? value.replace(pattern, real) : value;
  }
  value = value.replace(/\$\{?([a-z_]\w*)\}?/gi, (match, name: string) => variables.get(name.toLowerCase()) ?? match);
  return value && !/[$%`]/.test(value) ? value : null;
};

const piece_text = (piece: Piece): string | null => {
  if (piece.kind === "text") {
    return piece.text;
  }
  const inner = piece.kind === "group" && piece.open === "$(" ? piece.text.trim() : "";
  return lone_variable.test(inner) ? inner : null;
};

const literal = (word: Word): string | null => {
  if (word.op || !word.pieces.length) {
    return null;
  }
  let text = "";
  for (const piece of word.pieces) {
    const part = piece_text(piece);
    if (part === null) {
      return null;
    }
    text += part;
  }
  return text;
};

const is_flag = (word: Word) => /^[-\u2013\u2014\u2015]/.test(word.raw) || /^\/[a-z?](?::\S*)?$/i.test(word.raw);

const resolve_target = (token: string, walk: Walk): string | null => {
  const expanded = expand(token.trim(), walk.variables);
  if (expanded === null || (walk.location === null && !path.win32.isAbsolute(expanded))) {
    return null;
  }
  return path.win32.resolve(walk.location ?? "", expanded);
};

const unexplained = (text: string, walk: Walk): boolean => {
  if (!mentions_app(text)) {
    return false;
  }
  const words = shell_words(text, "powershell").filter((word) => mentions_app(word.raw));
  return !words.length || words.some((word) => unexplained_word(word, walk));
};

const unexplained_word = (word: Word, walk: Walk): boolean => {
  const text = literal(word);
  if (text !== null) {
    return text.split(",").some((token) => !in_project(resolve_target(token, walk), walk.scope));
  }
  return word.pieces.some((piece) => (piece.kind === "text" ? mentions_app(piece.text) : piece.kind !== "splat" && unexplained(piece.text, walk)));
};

const moved_location = (args: Word[], walk: Walk): string | null => {
  const targets = args.filter((word) => !is_flag(word));
  if (!targets.length) {
    return walk.location;
  }
  const text = targets.length === 1 && targets[0] ? literal(targets[0]) : null;
  return text === null ? null : resolve_target(text, walk);
};

const uses_app_variable = (text: string, walk: Walk) => [...text.matchAll(variable_use)].some((match) => walk.app_variables.has((match[1] ?? "").toLowerCase()));

const literal_hits = (word: Word, walk: Walk): boolean => {
  const text = is_flag(word) ? null : literal(word);
  return text !== null && text.split(",").some((token) => hits_app(resolve_target(token, walk), walk.scope));
};

const app_arguments = (text: string, args: Word[], walk: Walk): boolean =>
  args.some((word) => literal_hits(word, walk)) || uses_app_variable(text, walk) || unexplained(text, walk);

const command_of = (statement: string): Command => {
  let text = statement.trim();
  for (let assigned = assignment.exec(text); assigned; assigned = assignment.exec(text)) {
    text = (assigned[2] ?? "").trim();
  }
  const words = shell_words(text, "powershell");
  const at = words[0]?.raw === "&" ? 1 : 0;
  const head = words[at];
  return { text, verb: head ? (literal(head) ?? "") : "", words, args: words.slice(at + 1) };
};

const removes = (command: Command) => removal_verb.test(command.verb) || command.text.search(dotnet_delete) === 0;

const removes_each_item = (text: string) =>
  split_statements(text).some((statement) => {
    const command = command_of(statement);
    return removes(command) && pipeline_item.test(command.text);
  });

const value_expression = (text: string) => quote_of(text[0]) !== "" || /^[$@(]/.test(text);

const app_source = (command: Command, walk: Walk): boolean => {
  if (listing_verb.test(command.verb)) {
    return app_arguments(command.text, command.args, walk);
  }
  return value_expression(command.text) && app_arguments(command.text, command.words, walk);
};

const feeds_removal = (elements: StatementElement[], walk: Walk): boolean => {
  let carries = false;
  for (const element of elements) {
    const command = command_of(element.text);
    if (carries && (removes(command) || (each_verb.test(command.verb) && removes_each_item(command.text)))) {
      return true;
    }
    carries = pass_through_verb.test(command.verb) ? carries : app_source(command, walk);
  }
  return false;
};

const track_assignment = (name: string, value: string, walk: Walk): void => {
  const words = shell_words(value, "powershell");
  const text = words.length === 1 && words[0] ? literal(words[0]) : null;
  const expanded = text === null ? null : expand(text, walk.variables);
  if (expanded === null) {
    walk.variables.delete(name);
  } else {
    walk.variables.set(name, expanded);
  }
  if (unexplained(value, walk)) {
    walk.app_variables.add(name);
  } else {
    walk.app_variables.delete(name);
  }
};

const track_loop = (command: Command, walk: Walk): void => {
  const header = command.verb.toLowerCase() === "foreach" ? command.args[0]?.pieces[0] : undefined;
  const loop = header?.kind === "group" && header.open === "(" ? loop_header.exec(header.text) : null;
  if (loop) {
    track_assignment((loop[1] ?? "").toLowerCase(), (loop[2] ?? "").trim(), walk);
  }
};

const touches_app_data = (command: string, statements: string[], scope: FloorScope): boolean => {
  const walk: Walk = { scope, location: scope.cwd ? path.win32.resolve(scope.cwd) : null, variables: new Map(), app_variables: new Set() };
  for (const statement of statements) {
    const current = command_of(statement);
    if (location_verb.test(current.verb)) {
      walk.location = moved_location(current.args, walk);
      continue;
    }
    if (removes(current) && app_arguments(current.text, current.args, walk)) {
      return true;
    }
    const assigned = assignment.exec(statement);
    if (assigned) {
      track_assignment((assigned[1] ?? "").toLowerCase(), (assigned[2] ?? "").trim(), walk);
    }
    track_loop(current, walk);
  }
  return split_pipelines(command).some((pipeline) => statement_parts(pipeline).some((part) => feeds_removal(part.elements, walk)));
};

const bash_head = /(?:^|[\\/])(?:bash|sh|dash)(?:\.exe)?$/i;

const combined_c = /^-[a-z]*c$/i;

const posix_launch_payloads = (statements: string[]): string[] => {
  const payloads: string[] = [];
  for (const statement of statements) {
    const words = shell_words(statement, "powershell");
    const at = words[0]?.raw === "&" ? 1 : 0;
    const head = words[at] ? literal(words[at] as Word) : null;
    if (!head || !bash_head.test(head)) {
      continue;
    }
    const rest = words.slice(at + 1);
    const flag = rest.findIndex((word) => combined_c.test(word.raw));
    const payload = flag >= 0 ? rest[flag + 1] : undefined;
    const text = payload ? literal(payload) : null;
    if (text) {
      payloads.push(text);
    }
  }
  return payloads;
};

const feeder_source = (command: Command): string | null => {
  if (/^(?:echo|write-output|write-host|printf)$/i.test(command.verb)) {
    const parts = command.args.filter((word) => !is_flag(word)).map(literal).filter((value): value is string => value !== null);
    return parts.length ? parts.join(" ") : null;
  }
  const only = command.words.length === 1 ? command.words[0] : undefined;
  return only ? literal(only) : null;
};

const piped_bash_payloads = (command: string): string[] => {
  const payloads: string[] = [];
  for (const pipeline of split_pipelines(String(command || ""))) {
    for (const part of statement_parts(pipeline)) {
      for (let sink = 1; sink < part.elements.length; sink += 1) {
        const target = command_of((part.elements[sink] as StatementElement).text);
        if (!bash_head.test(target.verb) || target.args.some((word) => combined_c.test(word.raw))) continue;
        for (let source = 0; source < sink; source += 1) {
          const text = feeder_source(command_of((part.elements[source] as StatementElement).text));
          if (text) payloads.push(text);
        }
      }
    }
  }
  return payloads;
};

const powershell_floor_reason = (command: string, scope: FloorScope): string => {
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
  if (piped_delete) {
    return `${system_delete_reason} through a pipeline`;
  }
  const launched = [...posix_launch_payloads(statements), ...piped_bash_payloads(command)];
  const nested = launched.map((payload) => posix_floor_reason(payload, scope, powershell_floor_reason)).find(Boolean);
  if (nested) {
    return nested;
  }
  return touches_app_data(String(command || ""), statements, scope) ? app_reason : "";
};

export const floor_reason = (command: string, scope: FloorScope, dialect: Dialect = "powershell"): string =>
  dialect === "posix"
    ? posix_floor_reason(String(command || ""), scope, powershell_floor_reason)
    : powershell_floor_reason(command, scope);

import path from "node:path";
import {
  app_reason,
  cipher_reason,
  format_reason,
  hits_app,
  hklm_reason,
  is_system_path,
  mentions_app_data,
  partition_reason,
  shadow_reason,
  system_delete_reason,
  type FloorScope,
} from "./floor-shared.ts";
import { is_msys_root_target, msys_resolve, msys_translate, type MsysPath } from "./msys-paths.ts";
import { basename, head_index, is_flag, posix_literal } from "./posix-command.ts";
import { shell_words, type Word } from "./shell-words.ts";
import { posix_script, type PosixPipeline } from "./statements-posix.ts";
import type { StatementElement } from "./statements.ts";

export type CrossFloor = (command: string, scope: FloorScope) => string;

export const dd_reason = "overwriting a raw disk device with dd";

const delete_verbs = new Set(["rm", "rmdir", "unlink", "shred"]);

const removal_verbs = new Set(["rm", "rmdir", "unlink", "shred", "mv"]);

const env_names = new Set(["APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOME", "SYSTEMROOT", "WINDIR", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "SYSTEMDRIVE", "TEMP", "TMP"]);

const xargs_arg_flags = new Set(["-I", "-d", "-n", "-P", "-L", "-s", "-E", "-a"]);

const find_lead_flags = new Set(["-H", "-L", "-P"]);

const msys_virtual = /^\/(?:tmp|dev|proc)(?:[\\/]|$)/i;

const disk_device = /\/dev\/(?:sd|nvme|disk|hd|vd|mmcblk)|\/\/\.\/physicaldrive|\\\\\.\\physicaldrive/i;

const dd_disk = /\bof=["']?(?:\/dev\/(?:sd|nvme|disk|hd|vd|mmcblk)|\/\/\.\/physicaldrive|\\\\\.\\physicaldrive)/i;

const assignment = /^([A-Za-z_]\w*)=([\s\S]*)$/;

const env_value = (name: string): string | null => {
  const key = name.toUpperCase();
  if (key === "HOME") return process.env.USERPROFILE || process.env.HOME || null;
  return env_names.has(key) ? process.env[key] || null : null;
};

const expand_posix = (token: string, variables: Map<string, string>): string => {
  const home = env_value("HOME");
  let value = home ? token.replace(/^~(?=$|[\\/])/, home.replace(/[\\/]+$/, "")) : token;
  const lookup = (name: string): string | undefined => variables.get(name) ?? env_value(name) ?? undefined;
  value = value.replace(/\$\{([a-z_]\w*)\}/gi, (match, name: string) => lookup(name) ?? match);
  value = value.replace(/\$([a-z_]\w*)/gi, (match, name: string) => lookup(name) ?? match);
  return value;
};

type Classification = "system" | "app" | "none" | "unresolved";

type State = { location: string | null; variables: Map<string, string> };

const clone = (state: State): State => ({ location: state.location, variables: new Map(state.variables) });

const is_msys_system = (rest: string): boolean => is_msys_root_target(rest) || !msys_virtual.test(rest);

const program_reason = (statement: string): string => {
  if (/(?:^|[\s;&|(/])(?:diskpart|bcdedit)(?:\.exe)?(?=\s|$)/i.test(statement)) return partition_reason;
  if (/(?:^|[\s;&|(/])(?:parted|sfdisk|fdisk|gdisk)(?:\.exe)?(?=\s|$)/i.test(statement) && disk_device.test(statement)) return partition_reason;
  if (/(?:^|\s)format(?:\.com)?\s+(?:\/\/?\S+\s+)*[a-z]:/i.test(statement)) return format_reason;
  if (/(?:^|[\s;&|(/])(?:mkfs(?:\.\w+)?|mke2fs|mkntfs)(?=\s|$)/i.test(statement) && disk_device.test(statement)) return format_reason;
  if (/\bvssadmin(?:\.exe)?\s+delete\s+shadows\b/i.test(statement) || /\bwmic(?:\.exe)?\s+shadowcopy\s+delete\b/i.test(statement)) return shadow_reason;
  if (/\bcipher(?:\.exe)?\s+\/\/?w\b/i.test(statement)) return cipher_reason;
  if (/(?:^|[\s;&|(/])dd(?=\s)/i.test(statement) && dd_disk.test(statement)) return dd_reason;
  if (/(?:^|[\s;&|(/])reg(?:\.exe)?\s+delete\b/i.test(statement) && /\b(?:hklm|hkey_local_machine)\b/i.test(statement)) return hklm_reason;
  return "";
};

const unresolved_class = (expanded: string): Classification => {
  const translated = msys_translate(expanded, env_value("HOME"));
  if (translated.kind === "msys_root") {
    const cut = translated.rest.search(/[$`]/);
    if (cut < 0) return is_msys_system(translated.rest) ? "system" : "unresolved";
    const head = translated.rest.slice(0, cut);
    const dir = head.slice(0, head.lastIndexOf("/"));
    return dir && is_msys_system(dir) ? "system" : "unresolved";
  }
  const text = translated.kind === "windows" ? translated.path : translated.token.replace(/\//g, "\\");
  if (is_system_path(text)) return "system";
  return mentions_app_data(text) ? "app" : "unresolved";
};

const locate = (value: string, state: State): MsysPath => {
  const translated = msys_translate(value, env_value("HOME"));
  return translated.kind === "relative" && state.location ? msys_resolve(state.location, translated.token) : translated;
};

const classifier = (scope: FloorScope, state: State) => (token: string): Classification => {
  const expanded = expand_posix(token.trim(), state.variables);
  if (/[$`]/.test(expanded)) return unresolved_class(expanded);
  const target = locate(expanded, state);
  if (target.kind === "relative") return "none";
  if (target.kind === "msys_root") return is_msys_system(target.rest) ? "system" : "none";
  return is_system_path(target.path) ? "system" : hits_app(target.path, scope) ? "app" : "none";
};

const targets_of = (words: Word[], at: number): string[] =>
  words.slice(at + 1).filter((word) => !is_flag(word)).map(posix_literal).filter((value): value is string => value !== null);

const find_roots = (rest: Word[]): Word[] => {
  let index = 0;
  while (index < rest.length) {
    const raw = (rest[index] as Word).raw;
    if (find_lead_flags.has(raw) || /^-O/.test(raw)) index += 1;
    else if (raw === "-D") index += 2;
    else break;
  }
  const after = rest.slice(index);
  const flag = after.findIndex(is_flag);
  return after.slice(0, flag >= 0 ? flag : after.length);
};

const find_reason = (words: Word[], at: number, classify: (token: string) => Classification): string => {
  const rest = words.slice(at + 1);
  const deletes = rest.some((word, index) => word.raw === "-delete" || ((word.raw === "-exec" || word.raw === "-execdir") && removal_verbs.has(basename(posix_literal(rest[index + 1]) ?? ""))));
  if (!deletes) return "";
  const roots = find_roots(rest).map(posix_literal).filter((value): value is string => value !== null);
  return roots.some((token) => classify(token) === "system") ? system_delete_reason : roots.some((token) => classify(token) === "app") ? app_reason : "";
};

const removes = (verb: string, args: Word[]): boolean => {
  if (verb !== "xargs") return delete_verbs.has(verb);
  let index = 0;
  while (index < args.length) {
    const word = args[index] as Word;
    if (is_flag(word)) {
      index += xargs_arg_flags.has(word.raw) ? 2 : 1;
      continue;
    }
    return removal_verbs.has(basename(posix_literal(word) ?? ""));
  }
  return false;
};

const feeds_removal = (elements: StatementElement[], classify: (token: string) => Classification): string => {
  let carries: Classification = "none";
  for (const element of elements) {
    const words = shell_words(element.text, "posix");
    const { verb, at } = head_index(words);
    if (removes(verb, words.slice(at + 1))) {
      if (carries === "system") return system_delete_reason;
      if (carries === "app") return app_reason;
      continue;
    }
    for (const token of targets_of(words, at)) {
      const hit = classify(token);
      if (hit === "system" || hit === "app") carries = hit;
    }
  }
  return "";
};

const launch_cross = (statement: string): string[] => {
  const words = shell_words(statement, "posix");
  const { verb, at } = head_index(words);
  const rest = words.slice(at + 1);
  if (verb === "powershell" || verb === "pwsh") {
    const flag = rest.findIndex((word) => /^-(?:c|command|ec|e|enc|encodedcommand)$/i.test(word.raw));
    if (flag >= 0) {
      const value = posix_literal(rest[flag + 1]);
      if (value === null) return [];
      return /^-(?:ec|e|enc|encodedcommand)$/i.test(rest[flag]?.raw ?? "") ? [Buffer.from(value, "base64").toString("utf16le")] : [value];
    }
    if (rest.some((word) => /^-(?:file|psconsolefile)$/i.test(word.raw))) return [];
    let index = 0;
    while (index < rest.length && is_flag(rest[index] as Word)) index += 1;
    const payload = rest.slice(index).map((word) => word.raw).join(" ");
    return payload ? [payload] : [];
  }
  if (verb === "cmd") {
    const flag = rest.findIndex((word) => /^\/\/?[ck]$/i.test(word.raw));
    const value = rest.slice(flag + 1).map(posix_literal).filter((entry): entry is string => entry !== null).join(" ");
    return flag >= 0 && value ? [value.replace(/(?<!&)&(?!&)/g, ";")] : [];
  }
  return [];
};

const apply_cd = (token: string | null, state: State): void => {
  if (token === null) return;
  const target = locate(expand_posix(token, state.variables), state);
  if (target.kind === "windows") state.location = target.path;
  if (target.kind === "msys_root") state.location = target.rest;
};

const apply_simple = (stage: StatementElement, state: State): boolean => {
  const words = shell_words(stage.text, "posix");
  const { verb, at } = head_index(words);
  for (const word of words.slice(0, at)) {
    const assign = assignment.exec(posix_literal(word) ?? "");
    if (assign) state.variables.set(assign[1] ?? "", expand_posix(assign[2] ?? "", state.variables));
  }
  if ((verb === "cd" || verb === "pushd") && at + 1 < words.length) {
    apply_cd(posix_literal(words[at + 1] as Word), state);
    return true;
  }
  return false;
};

const classify_stage = (stage: StatementElement, classify: (token: string) => Classification): string => {
  const words = shell_words(stage.text, "posix");
  const { verb, at } = head_index(words);
  if (verb === "find") {
    const reason = find_reason(words, at, classify);
    if (reason) return reason;
  }
  if (delete_verbs.has(verb) || removal_verbs.has(verb)) {
    const tokens = targets_of(words, at);
    if (delete_verbs.has(verb) && tokens.some((token) => classify(token) === "system")) return system_delete_reason;
    if (removal_verbs.has(verb) && tokens.some((token) => classify(token) === "app")) return app_reason;
  }
  return "";
};

const walk_pipeline = (pipeline: PosixPipeline, scope: FloorScope, cross: CrossFloor | undefined, state: State): string => {
  for (const stage of pipeline.stages) {
    const program = program_reason(stage.text);
    if (program) return program;
    if (cross) {
      for (const payload of launch_cross(stage.text)) {
        const hit = cross(payload, scope);
        if (hit) return hit;
      }
    }
  }
  const cd = pipeline.simple ? apply_simple(pipeline.stages[0] as StatementElement, state) : false;
  const classify = classifier(scope, state);
  if (!cd) {
    for (const stage of pipeline.stages) {
      const reason = classify_stage(stage, classify);
      if (reason) return reason;
    }
    const feed = feeds_removal(pipeline.stages, classify);
    if (feed) return feed;
  }
  for (const nested of pipeline.nested) {
    const hit = run(nested, scope, cross, clone(state));
    if (hit) return hit;
  }
  return "";
};

const run = (command: string, scope: FloorScope, cross: CrossFloor | undefined, state: State): string => {
  const { pipelines, payloads } = posix_script(command);
  for (const payload of payloads) {
    const hit = run(payload, scope, cross, clone(state));
    if (hit) return hit;
  }
  for (const pipeline of pipelines) {
    const hit = walk_pipeline(pipeline, scope, cross, state);
    if (hit) return hit;
  }
  return "";
};

export const posix_floor_reason = (command: string, scope: FloorScope, cross?: CrossFloor): string =>
  run(String(command || ""), scope, cross, { location: scope.cwd ? path.win32.resolve(scope.cwd) : null, variables: new Map() });

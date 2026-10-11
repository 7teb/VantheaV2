import fs from "node:fs/promises";
import path from "node:path";
import type { ScriptRole } from "../../shared/review.ts";
import { is_inside, is_secret_path, project_real_root, to_posix } from "../project/scope.ts";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { floor_reason } from "./floor.ts";
import { expand_entry, local_imports, resolve_module } from "./script-loads.ts";
import { dynamic_path, executed_reads, protected_command_read, script_extension, script_refs, shell_source, source_depth, words } from "./script-refs.ts";
import { pins_digest, read_limit_bytes, read_source, type ScriptPin } from "./source-read.ts";
import { split_pipelines, split_statements } from "./statements.ts";
import { change_mark, type ChangeMark } from "./written-files.ts";

export type ScriptFile = {
  id: string;
  path: string;
  abs: string;
  role: ScriptRole;
  sha256: string | null;
  bytes: number;
  chars: number;
  text: string | null;
  binary: boolean;
  over_limit: boolean;
  change: ChangeMark | null;
};

export type CommandSources = { files: ScriptFile[]; gaps: string[]; catastrophic: string[]; protected_read: boolean; complete: boolean; hash: string; pins: ScriptPin[] };

export type SourceScope = { chat_id: string; chat_started_at: number };

const analysed_files = 32;

const listed_files = 200;

const no_scope: SourceScope = { chat_id: "", chat_started_at: Number.POSITIVE_INFINITY };

const role_rank: Record<ScriptRole, number> = { payload: 4, started: 3, manifest: 2, loaded: 1, named: 0 };

export const send_candidate = (file: ScriptFile): boolean =>
  file.text !== null && (file.role === "started" || file.role === "manifest" || file.role === "payload" || file.change !== null);

export const inspect_command_sources = async (project_root: string, cwd: string, command: string, scope: SourceScope = no_scope): Promise<CommandSources> => {
  const files: ScriptFile[] = [];
  const by_key = new Map<string, ScriptFile>();
  const pins = new Map<string, ScriptPin>();
  const manifests = new Map<string, Record<string, string>>();
  const manifest_raw = new Map<string, string>();
  const gaps: string[] = [];
  const catastrophic: string[] = [];
  const inspected = new Set<string>();
  const packages = new Set<string>();
  const active_packages = new Set<string>();
  let analysed = 0;
  let listed = 0;
  let root = "";
  const gap = (reason: string) => {
    if (!gaps.includes(reason)) gaps.push(reason);
  };
  if (project_root) {
    try { root = await project_real_root(project_root); }
    catch (error) { gap("Project inspection failed: " + error_text(error)); }
  }
  const pin = (file: string, sha256: string | null) => pins.set(path_key(file), { path: file, sha256 });
  const touch = async (file: string, role: ScriptRole, required: boolean): Promise<ScriptFile | null> => {
    const target = path.resolve(file);
    const known = by_key.get(path_key(target));
    if (known) {
      if (role_rank[role] > role_rank[known.role]) known.role = role;
      return known;
    }
    if (!root || !is_inside(root, target) || is_secret_path(target)) {
      if (required) gap("Source is outside the project or protected: " + target);
      return null;
    }
    const analysed_role = role === "started" || role === "manifest";
    if (analysed_role ? analysed >= analysed_files : listed >= listed_files) {
      gap(analysed_role ? "Source file limit exceeded (" + analysed_files + "): " + target : "Loaded file limit exceeded (" + listed_files + "): " + target);
      return null;
    }
    try {
      const real = await fs.realpath(target);
      if (!is_inside(root, real) || is_secret_path(real)) {
        gap("Source links outside the project or to a protected file: " + target);
        return null;
      }
      const read = await read_source(real);
      if (analysed_role) analysed += 1;
      else listed += 1;
      const entry: ScriptFile = {
        id: `s${files.length + 1}`,
        path: to_posix(path.relative(root, real)),
        abs: real,
        role,
        sha256: read.sha256,
        bytes: read.bytes,
        chars: read.text?.length ?? 0,
        text: read.text,
        binary: read.binary,
        over_limit: read.over_limit,
        change: change_mark(scope.chat_id, scope.chat_started_at, real, read.sha256, read.mtime),
      };
      files.push(entry);
      by_key.set(path_key(target), entry);
      pin(real, read.sha256);
      if (read.over_limit && (required || entry.change)) gap("Source file exceeds the read limit (" + read_limit_bytes.toLocaleString("en-US") + " bytes): " + target);
      return entry;
    } catch (error) {
      if (error_code(error) === "ENOENT") pin(target, null);
      if (required || error_code(error) !== "ENOENT") gap("Source is unavailable: " + target + " (" + error_code(error) + ")");
      return null;
    }
  };
  const load = async (entry: ScriptFile, depth: number, location: string): Promise<void> => {
    if (entry.text === null || depth >= source_depth) return;
    const found = await local_imports(entry.text, entry.abs, location);
    found.gaps.forEach(gap);
    for (const file of found.files) {
      const loaded = await touch(file, "loaded", false);
      if (loaded && send_candidate(loaded) && !inspected.has(loaded.abs + "\nload")) {
        inspected.add(loaded.abs + "\nload");
        await inspect(loaded.text ?? "", depth + 1, location, shell_source.test(loaded.abs), loaded.abs);
        await load(loaded, depth + 1, location);
      }
    }
  };
  const follow = async (file: string, depth: number, location: string, known_location: boolean, shell: boolean): Promise<void> => {
    if (dynamic_path.test(file) || !known_location) {
      gap("Script path or its working directory could not be resolved: " + file);
      return;
    }
    if (depth >= source_depth) {
      gap("Script inspection depth exceeded (" + source_depth + "): " + file);
      return;
    }
    const target = path.resolve(location, file);
    const key = target + "\n" + location;
    if (inspected.has(key)) return;
    inspected.add(key);
    const entry = await touch(target, "started", true);
    if (!entry) return;
    if (entry.binary && script_extension.test(target)) gap("Source file is binary: " + target);
    if (entry.text === null) return;
    await inspect(entry.text, depth + 1, location, shell, target);
    await load(entry, depth + 1, location);
  };
  const program = async (file: string, depth: number, location: string): Promise<void> => {
    const target = path.resolve(location, file);
    if (!root || !is_inside(root, target)) return;
    try {
      if (!(await fs.stat(target)).isFile()) return;
    } catch (error) {
      if (!missing_path(error)) gap("Source is unavailable: " + target + " (" + (error_code(error) || error_text(error)) + ")");
      return;
    }
    const entry = await touch(target, "started", false);
    if (entry?.text && depth < source_depth && !inspected.has(target + "\nprogram")) {
      inspected.add(target + "\nprogram");
      await inspect(entry.text, depth + 1, location, false, target);
    }
  };
  const loaded_entries = async (entries: string[], modules: ReturnType<typeof script_refs>["modules"], depth: number, location: string) => {
    for (const entry of entries) {
      const expanded = await expand_entry(entry, location);
      if (!expanded) {
        gap("Interpreter entry source could not be resolved: " + entry);
        continue;
      }
      expanded.gaps.forEach(gap);
      for (const file of expanded.files) {
        const loaded = await touch(file, "loaded", false);
        if (loaded && send_candidate(loaded)) await load(loaded, depth + 1, location);
      }
    }
    for (const module of modules) {
      let found: string | null = null;
      try { found = await resolve_module(module, location); }
      catch (error) {
        gap("Interpreter module or preload dependency could not be inspected: " + (module.spec || module.kind) + " (" + (error_code(error) || error_text(error)) + ")");
        continue;
      }
      if (!found) {
        gap("Interpreter module or preload dependency could not be inspected: " + (module.spec || module.kind));
        continue;
      }
      const loaded = await touch(found, "loaded", true);
      if (loaded && send_candidate(loaded)) {
        await inspect(loaded.text ?? "", depth + 1, location, false, found);
        await load(loaded, depth + 1, location);
      }
    }
  };
  const package_scripts = async (statement: string, depth: number, location: string, known_location: boolean) => {
    const package_call = /^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?(test|build|start|[\w:-]+)/i.exec(statement.trim());
    if (!package_call || !/^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run|test|build|start)\b/i.test(statement.trim())) return;
    if (!known_location) { gap("Package script working directory could not be resolved."); return; }
    const manifest_path = path.join(location, "package.json");
    const manifest = await touch(manifest_path, "manifest", true);
    if (!manifest) return;
    if (!manifest_raw.has(manifest.abs)) manifest_raw.set(manifest.abs, manifest.text ?? "");
    const selected = manifests.get(manifest.abs) ?? {};
    try {
      const parsed = JSON.parse(manifest_raw.get(manifest.abs) ?? "") as { scripts?: Record<string, string> };
      const name = package_call[1] ?? "";
      const key = manifest_path + ":" + name;
      if (typeof parsed.scripts?.[name] !== "string") { gap("Package script is missing: " + name); return; }
      if (active_packages.has(key) || depth >= source_depth) { gap("Package script recursion limit reached: " + key); return; }
      if (packages.has(key)) return;
      packages.add(key);
      active_packages.add(key);
      try {
        const lifecycle = /(?:^|\s)--ignore-scripts(?:\s|$)/i.test(statement) ? [name] : ["pre" + name, name, "post" + name];
        for (const entry of lifecycle) {
          const body = parsed.scripts?.[entry];
          if (typeof body !== "string") continue;
          selected[entry] = body;
          manifests.set(manifest.abs, selected);
          manifest.text = JSON.stringify(selected);
          manifest.chars = manifest.text.length;
          await inspect(body, depth + 1, location);
        }
      }
      finally { active_packages.delete(key); }
    } catch (error) {
      gap("Package script inspection failed: " + error_text(error));
    }
  };
  const inspect = async (text: string, depth: number, cwd_location: string, shell = true, origin = ""): Promise<void> => {
    let location = cwd_location;
    let known_location = true;
    if (shell && origin) {
      const hit = floor_reason(text);
      if (hit && !catastrophic.includes(origin + ": " + hit)) catastrophic.push(origin + ": " + hit);
    }
    if (shell) {
      for (const pipeline of split_pipelines(text)) {
        const executed = executed_reads(pipeline);
        if (executed.opaque) gap("Code that is built or downloaded at runtime gets executed and could not be inspected: " + pipeline.trim().slice(0, 200));
        for (const file of executed.files) await follow(file, depth, cwd_location, true, true);
      }
    }
    for (const statement of shell ? split_statements(text) : [text]) {
      const tokens = words(statement);
      if (shell && /^(?:cd|chdir|sl|set-location|push-location)$/i.test(tokens[0] ?? "")) {
        const target = tokens[1] ?? "";
        if (!target || tokens.length !== 2 || dynamic_path.test(target) || /^[-/]/.test(target)) {
          known_location = false;
          gap("Working directory change could not be resolved: " + statement);
        } else {
          location = path.resolve(location, target);
        }
      }
      if (shell && /^(?:pop-location|popd)$/i.test(tokens[0] ?? "")) {
        known_location = false;
        gap("Working directory restore could not be resolved: " + statement);
      }
      const refs = script_refs(statement, shell);
      refs.gaps.forEach(gap);
      for (const payload of refs.payloads) add_payload(payload);
      for (const file of refs.files) await follow(file, depth, location, known_location, shell_source.test(file));
      if (known_location) {
        for (const file of refs.programs) await program(file, depth, location);
        await loaded_entries(refs.entries, refs.modules, depth, location);
      }
      if (!shell) continue;
      if (known_location) await named(tokens.slice(1).filter((token) => !refs.files.includes(token)), depth, location);
      await package_scripts(statement, depth, location, known_location);
    }
  };
  const named = async (tokens: string[], depth: number, location: string) => {
    for (const token of tokens) {
      if (!script_extension.test(token) || dynamic_path.test(token)) continue;
      const entry = await touch(path.resolve(location, token), "named", false);
      if (entry && send_candidate(entry)) await load(entry, depth + 1, location);
    }
  };
  const add_payload = (text: string) => {
    if (files.some((file) => file.role === "payload" && file.text === text)) return;
    files.push({ id: `s${files.length + 1}`, path: "", abs: "", role: "payload", sha256: null, bytes: Buffer.byteLength(text), chars: text.length, text, binary: false, over_limit: false, change: null });
  };
  await inspect(command, 0, cwd || root);
  const pin_list = [...pins.values()];
  return { files, gaps, catastrophic, protected_read: protected_command_read(command), complete: gaps.length === 0, hash: pins_digest(pin_list), pins: pin_list };
};

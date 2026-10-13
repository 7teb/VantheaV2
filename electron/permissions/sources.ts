import path from "node:path";
import type { ScriptRole } from "../../shared/review.ts";
import { is_inside, project_real_root } from "../project/scope.ts";
import { error_code, error_text, missing_path } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";
import { build_description, build_references } from "./build-inputs.ts";
import { against_location, join_states, resolved, source_depth, unresolved, walk_command, type Effect, type Step, type Value, type WalkState } from "./command-walk.ts";
import { floor_reason, type FloorScope } from "./floor.ts";
import { launch_resolver, placed_state, type LaunchInput } from "./launch-resolver.ts";
import { launch_gap, location_matches, type ProgramFact } from "./launch-targets.ts";
import { package_runner } from "./package-scripts.ts";
import { source_language, type SourceLanguage } from "./script-constants.ts";
import { runner_file, test_sources } from "./script-discovery.ts";
import { code_imports, local_imports, type Loads } from "./script-loads.ts";
import { main_reach } from "./script-params.ts";
import { dynamic_path, executed_reads, process_refs, protected_command_read, runtime_text, script_dialect, script_extension } from "./script-refs.ts";
import { code_mask } from "./script-text.ts";
import { source_entries } from "./source-entries.ts";
import { send_candidate, source_files } from "./source-files.ts";
import { file_sha256, pins_digest, type ScriptPin } from "./source-read.ts";
import { split_pipelines, type Dialect } from "./statements.ts";
import { step_refs, type CodeRef, type Discovery } from "./step-refs.ts";
import { step_write } from "./step-writes.ts";
import { chat_written, type ChangeMark } from "./written-files.ts";

export type ScriptFile = {
  id: string;
  path: string;
  abs: string;
  outside: boolean;
  role: ScriptRole;
  sha256: string | null;
  bytes: number;
  chars: number;
  text: string | null;
  binary: boolean;
  over_limit: boolean;
  change: ChangeMark | null;
};

export type CommandSources = { files: ScriptFile[]; gaps: string[]; catastrophic: string[]; protected_read: boolean; complete: boolean; hash: string; pins: ScriptPin[]; programs: ProgramFact[]; notes: string[] };

export type SourceScope = { chat_id: string; chat_started_at: number; env?: Record<string, string | undefined>; shell?: Dialect; app_root?: string };

type Start = { dialect: Dialect | null; origin: string; state: WalkState; walk_depth: number; language?: SourceLanguage | null; entry?: boolean };

const no_scope: SourceScope = { chat_id: "", chat_started_at: Number.POSITIVE_INFINITY };

const candidates = (value: Value): string[] | null => ("values" in value ? value.values.filter(Boolean) : null);

const state_key = (state: WalkState): string =>
  JSON.stringify(state, (key, value: unknown) => (key === "base_env" ? undefined : value instanceof Map || value instanceof Set ? [...value] : value));

export const inspect_command_sources = async (project_root: string, cwd: string, command: string, scope: SourceScope = no_scope): Promise<CommandSources> => {
  const env = scope.env ?? process.env;
  const floor_scope: FloorScope = { app_root: scope.app_root ?? "", project_root, cwd: cwd || project_root };
  const gaps: string[] = [];
  const catastrophic: string[] = [];
  const notes: string[] = [];
  const follows = new Map<string, WalkState | null>();
  const loads = new Set<string>();
  const quiet_loads = new Set<string>();
  const written_now = new Map<string, string>();
  const reaching_main: string[] = [];
  let callers_resolved = false;
  const opaque: string[] = [];
  const resolved_iex = new Set<string>();
  const unresolved_iex = new Set<string>();
  const quiet: string[] = [];
  let root = "";
  const add = (list: string[], text: string) => {
    if (!list.includes(text)) list.push(text);
  };
  const note = (text: string) => add(notes, text);
  const gap = (reason: string) => (quiet.length ? note(`not raised, ${quiet.at(-1)}: ${reason}`) : add(gaps, reason));
  if (project_root) {
    try { root = await project_real_root(project_root); }
    catch (error) { gap("Project inspection failed: " + error_text(error)); }
  }
  const sources = source_files({ root, chat_id: scope.chat_id, chat_started_at: scope.chat_started_at, gap });
  const { files, inside, pin, touch } = sources;
  const quietly = async (why: string | null, run: () => Promise<void>) => {
    if (why) quiet.push(why);
    try {
      await run();
    } finally {
      if (why) quiet.pop();
    }
  };
  const opening = (location: string, dialect: Dialect): WalkState => {
    const first = walk_command("", { location, dialect, env }).next();
    return first.done ? first.value : first.value.state;
  };
  const take_loaded = async (found: Loads, depth: number, location: string, reach_outside: boolean, scan: boolean, discovered = false): Promise<void> => {
    found.gaps.forEach(gap);
    for (const file of found.files) {
      const loaded = await touch(file, "loaded", false, reach_outside);
      if (!loaded || !send_candidate(loaded)) continue;
      const unwritten = (loaded.role === "loaded" || loaded.role === "named") && loaded.change?.kind !== "written";
      const why = unwritten ? "inside a loaded module the agent did not write" : discovered ? "inside an agent-written file an installed tool may load" : null;
      if (loads.has(loaded.abs) || (why && quiet_loads.has(loaded.abs))) continue;
      (why ? quiet_loads : loads).add(loaded.abs);
      await quietly(why, async () => {
        if (scan) await inspect(loaded.text ?? "", depth + 1, { dialect: script_dialect(loaded.abs), origin: loaded.abs, state: opening(location, "cmd"), walk_depth: 0 });
        await load(loaded, depth + 1, location);
      });
    }
  };
  const load = async (entry: ScriptFile, depth: number, location: string, language: SourceLanguage | null = null): Promise<void> => {
    if (entry.text === null || depth >= source_depth) return;
    const build = build_description(entry.abs);
    await take_loaded(build ? await build_references(entry.text, entry.abs, root) : await local_imports(entry.text, entry.abs, location, language), depth, location, entry.outside, !build);
  };
  const locations = (written: string, value: Value): string[] => {
    if ("values" in value) return value.values;
    gap(launch_gap(written, value.unresolved));
    return [];
  };
  const discover = async (request: Discovery, depth: number) => {
    const paths = request.paths.flatMap((value) => ("values" in value ? value.values : []));
    for (const location of locations(request.runner ?? "installed package", request.location)) {
      const written = chat_written(scope.chat_id)
        .map((key) => path.resolve(key))
        .filter((file) => inside(file) && is_inside(location, file) && source_language(file) === request.language && runner_file(file, request.runner));
      const listed = await test_sources(request.runner, paths, location);
      await take_loaded({ files: [...new Set([...written.sort(), ...listed.files])], gaps: listed.gaps }, depth, location, false, true, request.runner === null);
    }
  };
  const read_input = async (input: LaunchInput, depth: number) => {
    const where = candidates(input.location);
    if (!where) note("input not read, working directory unknown: " + input.written);
    for (const location of where ?? []) {
      for (const value of input.values) {
        const file = path.win32.resolve(location, value);
        if (!inside(file)) {
          note("input outside the project, not read: " + file);
          continue;
        }
        const entry = await touch(file, "input", false);
        if (entry && send_candidate(entry)) await load(entry, depth + 1, location);
      }
    }
  };
  const follow = async (file: string, depth: number, dialect: Dialect | null, state: WalkState, same: boolean, language: SourceLanguage | null = null): Promise<WalkState | null> => {
    if (depth >= source_depth) {
      gap("Script inspection depth exceeded (" + source_depth + "): " + file);
      return null;
    }
    const key = path_key(file) + "\n" + same + "\n" + (quiet.length > 0) + "\n" + state_key(state);
    if (follows.has(key)) return follows.get(key) ?? null;
    follows.set(key, null);
    const written = written_now.get(path_key(file));
    if (written !== undefined) {
      note("script written by this command before it runs: " + file);
      try {
        pin(file, await file_sha256(file));
      } catch (error) {
        if (missing_path(error)) pin(file, null);
        else gap("Source is unavailable: " + file + " (" + (error_code(error) || error_text(error)) + ")");
      }
      if (!command.includes(written)) add_payload(written);
      const exit = (await inspect(written, depth + 1, { dialect, origin: file, state, walk_depth: 0, language: language ?? source_language(file), entry: true })) ?? state;
      follows.set(key, exit);
      return exit;
    }
    const entry = await touch(file, "started", true);
    if (!entry) return null;
    if (entry.binary) {
      gap((script_extension.test(file) ? "Source file is binary: " : "Launched file is binary and not an executable: ") + file);
      return null;
    }
    if (entry.text === null) return null;
    const exit = (await inspect(entry.text, depth + 1, { dialect, origin: file, state, walk_depth: 0, language, entry: true })) ?? state;
    for (const location of candidates(state.location.current) ?? [path.dirname(file)]) await load(entry, depth + 1, location, language);
    follows.set(key, exit);
    return exit;
  };
  const named = async (values: Value[], depth: number, step: Step) => {
    const bases = candidates(step.location) ?? [];
    for (const token of values.flatMap((value) => ("values" in value ? value.values : []))) {
      if (!script_extension.test(token) || dynamic_path.test(token)) continue;
      for (const base of bases) {
        const entry = await touch(path.resolve(base, token), "named", false);
        if (entry && send_candidate(entry)) await load(entry, depth + 1, base);
      }
    }
  };
  const installed = (location: Value, depth: number) => discover({ location, language: "js", runner: null, paths: [] }, depth);
  const launches = launch_resolver({ scope, inside, gap, note, pin, follow, installed });
  const entries = source_entries({ inside, gap, pin, touch, follow, load, discover, locations, add_fact: launches.add_fact, scan: (text, depth, origin, location) => inspect(text, depth, { dialect: script_dialect(origin), origin, state: opening(location, "cmd"), walk_depth: 0 }) });
  const add_payload = (text: string) => {
    if (files.some((file) => file.role === "payload" && file.text === text)) return;
    files.push({ id: `s${files.length + 1}`, path: "", abs: "", outside: false, role: "payload", sha256: null, bytes: Buffer.byteLength(text), chars: text.length, text, binary: false, over_limit: false, change: null });
    const hit = floor_reason(text, floor_scope);
    if (hit) add(catastrophic, "payload: " + hit);
  };
  const runtime_scan = async (text: string, depth: number, state: WalkState) => {
    for (const pipeline of split_pipelines(text)) {
      const executed = executed_reads(pipeline);
      if (executed.opaque) opaque.push(pipeline);
      for (const read of executed.files) {
        const full = dynamic_path.test(read.file) ? unresolved("expression not evaluated") : against_location(resolved([read.file]), state.location.current);
        for (const file of locations(read.file, full)) await follow(file, depth, script_dialect(file) ?? read.dialect, state, false);
      }
    }
  };
  const payload = async (step: Step, runtime: boolean, depth: number) => {
    const found = step.payload;
    if (runtime && !found?.walked) unresolved_iex.add(step.text);
    if (!found) return;
    if ("unresolved" in found.value) {
      if (!runtime) gap(`Payload could not be resolved: ${found.written} (${found.value.unresolved})`);
      return;
    }
    if (!found.walked) {
      gap("Inline source inspection depth exceeded (" + source_depth + ").");
      return;
    }
    if (runtime) resolved_iex.add(step.text);
    for (const text of found.value.values.filter((entry) => !step.text.includes(entry))) {
      add_payload(text);
      await runtime_scan(text, depth, step.state);
    }
  };
  const run_code = async (code: CodeRef, step: Step, depth: number) => {
    if ("unresolved" in code.value) {
      gap(`Payload could not be resolved: ${code.written} (${code.value.unresolved})`);
      return;
    }
    if (step.depth >= source_depth) {
      gap("Inline source inspection depth exceeded (" + source_depth + ").");
      return;
    }
    for (const text of code.value.values) {
      if (!step.text.includes(text)) add_payload(text);
      await inspect(text, depth, { dialect: code.dialect, language: code.language, origin: "", state: placed_state(step.state, code.location), walk_depth: step.depth + 1, entry: true });
      if (!code.language || !/\b(?:import|require)\b|__import__/.test(text)) continue;
      for (const location of locations(code.written, code.location)) await take_loaded(await code_imports(text, code.language, location), depth, location, true, true);
    }
  };
  const packages = package_runner({ root, touch, gap, run: (body, depth, state) => inspect(body, depth, { dialect: "cmd", origin: "", state, walk_depth: 0 }) });
  const initial = resolved([path.win32.resolve(cwd || root)]);
  const on_step = async (step: Step, depth: number): Promise<Effect | undefined> => {
    if ("unresolved" in step.location) note(step.location.unresolved);
    const write = step_write(step);
    for (const file of write?.files ?? []) written_now.set(path_key(file), write?.text ?? "");
    const refs = step_refs(step, initial);
    refs.gaps.forEach(gap);
    refs.notes.forEach(note);
    await payload(step, refs.runtime, depth);
    const exits: WalkState[] = [];
    let complete = step.in_process && !refs.runtime;
    for (const ref of refs.launches) {
      const found = await launches.launch(ref, step, depth);
      if (ref.same_process && found) exits.push(...found);
      else if (ref.same_process) complete = false;
    }
    for (const input of launches.take_inputs()) await read_input(input, depth);
    for (const code of refs.code) await run_code(code, step, depth);
    await entries(refs, step, depth);
    if (refs.package) {
      const where = candidates(step.location);
      if (!where) gap("Package script working directory could not be resolved.");
      for (const location of where ?? []) await packages(refs.package, depth, location, step.state);
    }
    await named(refs.named, depth, step);
    return complete && exits.length ? { kind: "exit", state: exits.reduce(join_states) } : undefined;
  };
  const inspect = async (text: string, depth: number, start: Start): Promise<WalkState | null> => {
    if (start.dialect === null) {
      const language = start.language ?? source_language(start.origin);
      const found = process_refs(text, language, start.origin, start.entry === true);
      found.gaps.forEach(gap);
      callers_resolved ||= found.callers;
      if (!start.entry && language === "python" && main_reach.test(code_mask(text, "python"))) reaching_main.push(start.origin);
      for (const entry of found.packages) {
        launches.add_fact({ written: entry.written, how: "installed package", path: entry.spec, kind: "installed", bytes: null, outside: false, change: null, origin: start.origin, line: entry.line });
      }
      if (found.packages.length) await installed(start.state.location.current, depth);
      for (const line of found.commands) await inspect(line, depth, { ...start, dialect: "cmd", origin: "" });
      return null;
    }
    const hit = start.origin ? floor_reason(text, floor_scope) : null;
    if (hit) add(catastrophic, start.origin + ": " + hit);
    await runtime_scan(text, depth, start.state);
    const walk = walk_command(text, { location: "", dialect: start.dialect, env, script_path: start.origin, state: start.state, matches: location_matches, depth: start.walk_depth });
    let next = walk.next();
    while (!next.done) next = walk.next(await on_step(next.value, depth));
    return next.value;
  };
  const dialect = scope.shell ?? "powershell";
  await inspect(command, 0, { dialect, origin: "", state: opening(cwd || root, dialect), walk_depth: 0 });
  for (const pipeline of opaque) {
    const rest = [...resolved_iex].reduce((text, done) => text.split(done).join(" "), pipeline);
    if (runtime_text(rest) || [...unresolved_iex].some((text) => pipeline.includes(text))) {
      gap("Code that is built or downloaded at runtime gets executed and could not be inspected: " + pipeline.trim().slice(0, 200));
    }
  }
  if (callers_resolved && reaching_main.length) gap("A loaded module reaches into the started script, so arguments taken from its own call sites are not proven: " + reaching_main.join(", "));
  if (sources.unlisted()) note(`loaded files over the limit of ${sources.listed_limit}, not read: ${sources.unlisted()}`);
  const pin_list = [...sources.pins.values()];
  return { files, gaps, catastrophic, protected_read: protected_command_read(command), complete: gaps.length === 0, hash: pins_digest(pin_list), pins: pin_list, programs: launches.programs, notes };
};

import path from "node:path";
import { is_secret_path } from "../../shared/secret-path.ts";
import type { InputRef } from "./build-inputs.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { against_location, child_state, resolved, type Step, type Value, type WalkState } from "./command-walk.ts";
import {
  env_value, expand_launch_pattern, launch_extensions, launch_gap, launch_kind, native_extension, network_path, path_dirs, path_lookup, wildcard_path,
  type LaunchKind, type PathMatch, type ProgramFact, type ProgramKind,
} from "./launch-targets.ts";
import { msys_mounts, msys_native } from "./msys-paths.ts";
import { bash_builtins } from "./posix-command.ts";
import { powershell_command } from "./powershell-commands.ts";
import { script_dialect, script_extension } from "./script-refs.ts";
import { file_sha256, stat_optional } from "./source-read.ts";
import type { Dialect } from "./statements.ts";
import type { LaunchRef } from "./step-refs.ts";
import { change_mark, type ChangeMark, type FileTimes } from "./written-files.ts";

export type LaunchInput = InputRef & { location: Value };

export type LaunchHost = {
  scope: { chat_id: string; chat_started_at: number };
  inside: (file: string) => boolean;
  gap: (reason: string) => void;
  note: (text: string) => void;
  pin: (file: string, sha256: string | null) => void;
  follow: (file: string, depth: number, dialect: Dialect | null, state: WalkState, same: boolean) => Promise<WalkState | null>;
  installed: (location: Value, depth: number) => Promise<void>;
};

const native_name = /[\\/]([^\\/$%`"'*?]+\.(?:exe|com))["']?$/i;

const filesystem_provider = /^(?:[\w.]+\\)?filesystem::/i;

export const placed_state = (state: WalkState, location: Value): WalkState => ({ ...child_state(state), location: { current: location, stack: [], stack_known: true } });

export const launch_resolver = (host: LaunchHost) => {
  const programs: ProgramFact[] = [];
  const inputs: LaunchInput[] = [];
  const lookup = path_lookup();
  const marked = (file: string, sha256: string | null, times: FileTimes) => change_mark(host.scope.chat_id, host.scope.chat_started_at, file, sha256, times);
  const add_fact = (fact: ProgramFact) => {
    const same = (known: ProgramFact) => known.written === fact.written && known.how === fact.how && known.origin === fact.origin && known.path.toLowerCase() === fact.path.toLowerCase();
    if (!programs.some(same)) programs.push(fact);
  };
  const program = (ref: LaunchRef, step: Step, file: string, kind: ProgramKind, bytes: number | null = null, change: ChangeMark | null = null) => {
    if (kind !== "command") inputs.push(...ref.inputs.map((input) => ({ ...input, location: ref.child })));
    add_fact({ written: ref.written, how: ref.how, path: file, kind, bytes, outside: path.win32.isAbsolute(file) && !host.inside(file), change, origin: step.origin, line: step.line });
  };
  const native = async (file: string, kind: Extract<LaunchKind, { bytes: number }>, ref: LaunchRef, step: Step) => {
    let sha256: string | null = null;
    if (host.inside(file)) {
      try {
        sha256 = await file_sha256(file);
      } catch (error) {
        host.gap("Source is unavailable: " + file + " (" + (error_code(error) || error_text(error)) + ")");
        return;
      }
      host.pin(file, sha256);
    }
    program(ref, step, file, "native", kind.bytes, marked(file, sha256, kind));
  };
  const extensions = (step: Step, ref: LaunchRef): string[] => {
    const value = env_value(step.state, "pathext");
    return launch_extensions("values" in value ? (value.values[0] ?? "") : "", step.dialect === "powershell" && ref.search !== "location_then_path");
  };
  const launch_file = async (file: string, ref: LaunchRef, step: Step, depth: number): Promise<WalkState | null> => {
    if (network_path(file)) {
      if (ref.mode === "script" || !native_extension.test(file)) {
        host.gap("Source is on a network path and was not read: " + file);
        return null;
      }
      program(ref, step, file, "network");
      return step.state;
    }
    let target = file;
    let kind = await launch_kind(file);
    const probes = kind.kind === "missing" && ref.mode !== "script" && !path.extname(file) ? extensions(step, ref).map((ext) => file + ext) : [];
    for (const probe of probes) {
      const found = await launch_kind(probe);
      if (found.kind === "missing") continue;
      [target, kind] = [probe, found];
      break;
    }
    if (kind.kind === "directory") return step.state;
    const program_target = ref.mode !== "script" && !is_secret_path(target);
    if (program_target && kind.kind === "native") {
      await native(target, kind, ref, step);
      return step.state;
    }
    if (program_target && kind.kind === "missing" && (native_extension.test(target) || probes.length)) {
      [target, ...probes].filter(host.inside).forEach((absent) => host.pin(absent, null));
      program(ref, step, target, "missing");
      return step.state;
    }
    return host.follow(target, depth, script_dialect(target), ref.same_process ? step.state : placed_state(step.state, ref.child), ref.same_process);
  };
  const path_fact = async (match: PathMatch, ref: LaunchRef, step: Step, depth: number): Promise<boolean> => {
    const shown = { ...ref, how: [ref.how, match.installed ? "installed package" : "PATH"].filter(Boolean).join(", ") };
    if (match.installed) {
      program(shown, step, match.file, "installed");
      await host.installed(ref.child, depth);
      return false;
    }
    const kind = await launch_kind(match.file);
    if (kind.kind === "native") program(shown, step, match.file, "native", kind.bytes, marked(match.file, null, kind));
    else if (kind.kind === "file") program(shown, step, match.file, "script", kind.bytes);
    else if (kind.kind === "unreadable") program(shown, step, match.file, "unreadable");
    return kind.kind === "file" || kind.kind === "unreadable";
  };
  const builtin_launch = async (name: string, builtin: string, names: string[], ref: LaunchRef, step: Step): Promise<WalkState> => {
    const listed = env_value(step.state, "path");
    const shadows = builtin !== name.toLowerCase() && "values" in listed && (await lookup(names, listed.values.flatMap(path_dirs))).length > 0;
    if (!ref.literal || shadows) program(ref, step, builtin, "builtin");
    return step.state;
  };
  const bare_launch = async (name: string, ref: LaunchRef, step: Step, depth: number): Promise<WalkState | null> => {
    if (ref.search === "none" || (step.dialect === "posix" && bash_builtins.has(name))) return step.state;
    const exts = extensions(step, ref);
    const own = exts.includes(path.extname(name).toLowerCase());
    const names = own ? [name] : [...(path.extname(name) ? [name] : []), ...exts.map((ext) => name + ext)];
    const builtin = step.dialect === "powershell" ? powershell_command(name) : null;
    if (builtin) return builtin_launch(name, builtin, names, ref, step);
    const bases: string[] = [];
    for (const base of ref.search === "location_then_path" || script_extension.test(name) ? ref.bases : []) {
      if ("unresolved" in base) {
        host.gap(launch_gap(ref.written, base.unresolved));
        return null;
      }
      bases.push(...base.values);
    }
    const nearby = bases.flatMap((base) => names.map((entry) => path.win32.join(base, entry)));
    const passed: string[] = [];
    for (const file of ref.search === "location_then_path" ? nearby : []) {
      if ((await launch_kind(file)).kind === "missing") {
        passed.push(file);
        continue;
      }
      passed.filter(host.inside).forEach((entry) => host.pin(entry, null));
      return launch_file(file, { ...ref, mode: "path" }, step, depth);
    }
    const listed = env_value(step.state, "path");
    if ("unresolved" in listed) {
      host.gap(launch_gap(ref.written, "PATH changed to an unresolved value"));
      return null;
    }
    const matches = await lookup(names, listed.values.flatMap(path_dirs));
    if (!matches.length) {
      if (nearby[0] && script_extension.test(name)) return launch_file(nearby[0], { ...ref, mode: "path" }, step, depth);
      if (own) program(ref, step, name, "not_found");
      else if (!ref.literal) program(ref, step, name, step.dialect === "powershell" ? "powershell_command" : "command");
      return step.state;
    }
    let exit: WalkState | null = step.state;
    let unread = false;
    for (const match of matches) {
      const first = match.dir === matches[0]?.dir;
      const info = !match.installed && script_extension.test(match.file) ? await stat_optional(match.file, "a PATH script") : null;
      if (info && marked(match.file, null, { mtime: info.mtimeMs, birthtime: info.birthtimeMs })) {
        const read = await launch_file(match.file, { ...ref, mode: "path" }, step, depth);
        if (first) exit = read;
      } else if (first) {
        unread = (await path_fact(match, ref, step, depth)) || unread;
      }
    }
    return unread && ref.same_process ? null : exit;
  };
  const targets_of = async (candidate: string, ref: LaunchRef): Promise<string[] | null> => {
    const targets: string[] = [];
    for (const base of ref.bases) {
      const full = against_location(resolved([candidate]), base);
      if ("unresolved" in full) {
        host.gap(launch_gap(ref.written, full.unresolved));
        return null;
      }
      targets.push(...full.values.filter((entry) => !targets.includes(entry)));
    }
    const present: string[] = [];
    for (const target of targets.length > 1 ? targets : []) {
      if ((await launch_kind(target)).kind !== "missing") present.push(target);
      else if (host.inside(target)) host.pin(target, null);
    }
    return present.length ? present : targets;
  };
  const launch = async (ref: LaunchRef, step: Step, depth: number): Promise<WalkState[] | null> => {
    if ("unresolved" in ref.value) {
      const name = ref.mode === "script" ? undefined : native_name.exec(ref.written)?.[1];
      if (name) {
        program({ ...ref, how: [ref.how, "folder not resolved: " + ref.value.unresolved].filter(Boolean).join(", ") }, step, name, "unresolved_folder");
        return [step.state];
      }
      host.gap(launch_gap(ref.written, ref.value.unresolved));
      return null;
    }
    const exits: WalkState[] = [];
    let complete = true;
    const keep = (exit: WalkState | null) => {
      if (exit) exits.push(exit);
      else complete = false;
    };
    const mounts = step.dialect === "posix" ? msys_mounts() : null;
    for (const written of ref.value.values.map((entry) => entry.replace(filesystem_provider, ""))) {
      const candidate = mounts ? (msys_native(written, mounts) ?? written) : written;
      if (!candidate || /^[a-z][a-z0-9+.-]+:(?!:)/i.test(candidate)) continue;
      if (candidate.includes("::")) {
        host.gap(launch_gap(ref.written, "provider path"));
        keep(null);
        continue;
      }
      if (ref.mode === "command" && !/[\\/]|^[A-Za-z]:/.test(candidate)) {
        keep(await bare_launch(candidate, ref, step, depth));
        continue;
      }
      const targets = await targets_of(candidate, ref);
      if (!targets) keep(null);
      for (const file of targets ?? []) {
        if (ref.mode === "script" || step.dialect !== "powershell" || !wildcard_path(file)) {
          keep(await launch_file(file, ref, step, depth));
          continue;
        }
        const pattern = await expand_launch_pattern(file);
        pattern.gaps.forEach(host.gap);
        if (pattern.reason) {
          host.gap(launch_gap(ref.written, pattern.reason));
          keep(null);
        }
        for (const match of pattern.files) keep(await launch_file(match, ref, step, depth));
      }
    }
    return complete ? exits : null;
  };
  return { programs, launch, add_fact, take_inputs: () => inputs.splice(0) };
};

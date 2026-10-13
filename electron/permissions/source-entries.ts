import path from "node:path";
import type { ScriptRole } from "../../shared/review.ts";
import { error_code, error_text } from "../storage/coerce.ts";
import { resolved, type Step, type Value, type WalkState } from "./command-walk.ts";
import { placed_state } from "./launch-resolver.ts";
import type { ProgramFact } from "./launch-targets.ts";
import type { SourceLanguage } from "./script-constants.ts";
import { test_runner } from "./script-discovery.ts";
import { entry_file, expand_entry, is_file, resolve_module, type ModuleTarget } from "./script-loads.ts";
import { script_dialect } from "./script-refs.ts";
import { send_candidate } from "./source-files.ts";
import type { ScriptFile } from "./sources.ts";
import type { Dialect } from "./statements.ts";
import type { Discovery, StepRefs } from "./step-refs.ts";

export type EntryHost = {
  inside: (file: string) => boolean;
  gap: (reason: string) => void;
  pin: (file: string, sha256: string | null) => void;
  touch: (file: string, role: ScriptRole, required: boolean) => Promise<ScriptFile | null>;
  follow: (file: string, depth: number, dialect: Dialect | null, state: WalkState, same: boolean, language: SourceLanguage | null) => Promise<WalkState | null>;
  load: (entry: ScriptFile, depth: number, location: string) => Promise<void>;
  discover: (request: Discovery, depth: number) => Promise<void>;
  locations: (written: string, value: Value) => string[];
  add_fact: (fact: ProgramFact) => void;
  scan: (text: string, depth: number, origin: string, location: string) => Promise<unknown>;
};

const failure = (error: unknown): string => error_code(error) || error_text(error);

export const source_entries = (host: EntryHost) => {
  const present = async (file: string, label: string): Promise<boolean> => {
    try {
      return await is_file(file);
    } catch (error) {
      host.gap(`${label} could not be read: ${file} (${failure(error)})`);
      return false;
    }
  };
  const interpreter_entries = async (refs: StepRefs, step: Step, depth: number) => {
    for (const entry of refs.entries) {
      for (const location of host.locations(entry.written, entry.location)) {
        for (const candidate of "values" in entry.value ? entry.value.values : []) {
          const expanded = await expand_entry(candidate, location);
          if (expanded) {
            expanded.gaps.forEach(host.gap);
            for (const file of expanded.files) {
              const loaded = await host.touch(file, "loaded", false);
              if (loaded && send_candidate(loaded)) await host.load(loaded, depth + 1, location);
            }
            continue;
          }
          let file: string | null;
          try {
            file = await entry_file(candidate, location, entry.language);
          } catch (error) {
            host.gap("Interpreter entry source could not be read: " + candidate + " (" + failure(error) + ")");
            continue;
          }
          if (file) await host.follow(file, depth, script_dialect(file), placed_state(step.state, resolved([location])), false, entry.language);
          else host.gap("Interpreter entry source could not be resolved: " + candidate);
        }
      }
    }
  };
  const modules = async (refs: StepRefs, step: Step, depth: number) => {
    for (const { module, location: where, args } of refs.modules) {
      const how = module.kind === "python" ? "python -m" : "node preload";
      const fact = (file: string, kind: ProgramFact["kind"]) =>
        host.add_fact({ written: module.spec, how, path: file, kind, bytes: null, outside: kind === "missing" && !host.inside(file), change: null, origin: step.origin, line: step.line });
      for (const location of host.locations(module.spec || module.kind, where)) {
        if (!module.spec) {
          host.gap("Interpreter module or preload dependency could not be inspected: " + module.kind);
          continue;
        }
        let found: ModuleTarget;
        try {
          found = await resolve_module(module, location);
        } catch (error) {
          host.gap("Interpreter module or preload dependency could not be inspected: " + module.spec + " (" + failure(error) + ")");
          continue;
        }
        if (found.kind === "installed") {
          fact(module.spec, "installed");
          const runner = module.kind === "python" ? test_runner(module.spec) : null;
          if (runner) await host.discover({ location: resolved([location]), language: "python", runner, paths: args }, depth);
          continue;
        }
        if (found.kind === "missing") {
          if (host.inside(found.file)) host.pin(found.file, null);
          fact(found.file, "missing");
          continue;
        }
        const loaded = await host.touch(found.file, "loaded", true);
        if (!loaded || !send_candidate(loaded)) continue;
        await host.scan(loaded.text ?? "", depth + 1, found.file, location);
        await host.load(loaded, depth + 1, location);
      }
    }
  };
  const builds = async (refs: StepRefs, step: Step, depth: number) => {
    for (const build of refs.builds) {
      for (const location of host.locations("pip install", build.location)) {
        for (const dir of host.locations("pip install", build.dir)) {
          const folder = path.resolve(location, dir);
          const setup = path.join(folder, "setup.py");
          if (await present(setup, "Package build script")) await host.follow(setup, depth, null, placed_state(step.state, resolved([folder])), false, "python");
        }
      }
    }
  };
  return async (refs: StepRefs, step: Step, depth: number): Promise<void> => {
    await interpreter_entries(refs, step, depth);
    await modules(refs, step, depth);
    for (const request of refs.discovery) await host.discover(request, depth);
    await builds(refs, step, depth);
  };
};

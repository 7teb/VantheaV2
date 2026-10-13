import { input_values, type InputRef } from "./build-inputs.ts";
import { against_location, concat, powershell_switch, powershell_takes_value, resolved, unresolved, type Step, type StepWord, type Value } from "./command-walk.ts";
import { launch_gap } from "./launch-targets.ts";
import { local_build_dirs, package_call, type PackageCall } from "./package-calls.ts";
import type { SourceLanguage } from "./script-constants.ts";
import { quote_arg, script_extension, syntax_check, type ModuleRef } from "./script-refs.ts";
import type { Dialect } from "./statements.ts";

const interpreter_name = /^(?:python(?:\d+(?:\.\d+)*)?|py|node|tsx|ts-node|ruby|perl|php|lua|rscript|bash|sh|powershell|pwsh)$/;

const package_manager = /^(?:npm|pnpm|yarn)$/;

const shell_program = /^(?:cmd|powershell|pwsh|bash|sh)$/;

const python_values = new Set(["-X", "-W", "--check-hash-based-pycs"]);

const node_values = new Set(["--env-file", "--conditions", "-C", "--input-type", "--title", "--inspect-port", "--redirect-warnings", "--diagnostic-dir", "--report-dir", "--report-filename", "--icu-data-dir", "--openssl-config", "--disable-warning", "--stack-trace-limit"]);

const node_preloads = /^(?:--require|-r|--import|--loader|--experimental-loader)$/;

export type LaunchMode = "command" | "path" | "script";

export type LaunchRef = { written: string; value: Value; how: string; mode: LaunchMode; bases: Value[]; search: Step["search"]; same_process: boolean; literal: boolean; child: Value; inputs: InputRef[] };

export type CodeRef = { written: string; value: Value; dialect: Dialect | null; language: SourceLanguage | null; location: Value };

export type EntryRef = { written: string; value: Value; location: Value; language: SourceLanguage | null };

export type Discovery = { location: Value; language: SourceLanguage; runner: "pytest" | "unittest" | "node" | null; paths: Value[] };

export type StepRefs = {
  launches: LaunchRef[];
  code: CodeRef[];
  entries: EntryRef[];
  modules: { module: ModuleRef; location: Value; args: Value[] }[];
  package: PackageCall | null;
  discovery: Discovery[];
  builds: { dir: Value; location: Value }[];
  named: Value[];
  runtime: boolean;
  gaps: string[];
  notes: string[];
};

type Arg = { written: string; value: Value; parts: Value[]; quoted: boolean };

type Launcher = { step: Step; refs: StepRefs; how: string; bases: Value[]; child: Value; search: Step["search"]; same_process: boolean };

const single = (value: Value | undefined): string | null => (value && "values" in value && value.values.length === 1 && !value.list ? (value.values[0] ?? null) : null);

const flag_of = (arg: Arg | undefined): string => (single(arg?.value) ?? "").toLowerCase();

const literal = (value: Value, text: string): boolean => "values" in value && value.values.every((entry) => text.includes(entry));

const unresolved_gap = (refs: StepRefs, written: string, value: { unresolved: string }) => {
  refs.gaps.push(launch_gap(written, value.unresolved));
};

const program_of = (value: Value): string => {
  if (!("values" in value)) return "";
  const names = new Set(value.values.map((entry) => (entry.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(?:exe|com|cmd|bat)$/, "")));
  return names.size === 1 ? ([...names][0] ?? "") : "";
};

const args_of = (words: StepWord[]): Arg[] => {
  const args: Arg[] = [];
  let comma = false;
  for (const [index, entry] of words.entries()) {
    const before = words[index - 1]?.word;
    if (entry.word.op === ",") {
      comma = true;
      continue;
    }
    if (entry.word.op || (before?.op && before.op !== "," && !before.raw.includes("&"))) {
      comma = false;
      continue;
    }
    const parts = "values" in entry.value && entry.value.list ? entry.value.values.map((item) => resolved([item])) : [entry.value];
    const last = args.at(-1);
    const piece = entry.word.pieces[0];
    if (comma && last) {
      last.written += "," + entry.word.raw;
      last.parts.push(...parts);
      last.value = unresolved("not a string");
    } else {
      args.push({ written: entry.word.raw, value: entry.value, parts, quoted: piece?.kind === "text" && piece.quote !== "none" });
    }
    comma = false;
  }
  return args;
};

const head_index = (step: Step, args: Arg[]): number => {
  const first = (args[0]?.written ?? "").toLowerCase().replace(/^@+/, "");
  if (step.dialect === "cmd") return first === "call" ? 1 : 0;
  if (step.dialect === "posix") return first === "source" || first === "." ? 1 : 0;
  return first === "&" || first === "." ? 1 : 0;
};

const command_line = (argv: Arg[]): Value =>
  concat(argv.flatMap((arg, index) => {
    const quoted = "values" in arg.value ? resolved(arg.value.values.map(quote_arg)) : arg.value;
    return index ? [resolved([" "]), quoted] : [quoted];
  }));

const argument_list = (list: Arg | undefined): Arg[] =>
  (list?.parts ?? []).flatMap((part): Arg[] => {
    const text = single(part);
    if (text === null) return [{ written: list?.written ?? "", value: "unresolved" in part ? part : unresolved("more than one possible argument list"), parts: [part], quoted: false }];
    return [...text.matchAll(/(?:"[^"]*"|[^\s"])+/g)].map((match) => {
      const token = match[0].replaceAll('"', "");
      return { written: token, value: resolved([token]), parts: [resolved([token])], quoted: false };
    });
  });

const argument_inputs = (args: Arg[], dialect: Dialect): InputRef[] =>
  args.flatMap((arg) => {
    const values = arg.parts.flatMap((part) => ("values" in part ? input_values(part.values, arg.quoted, dialect) : []));
    return values.length ? [{ written: arg.written, values }] : [];
  });

const launch = (at: Launcher, arg: Arg, mode: LaunchRef["mode"], value: Value = arg.value, inputs: InputRef[] = []): void => {
  at.refs.launches.push({ written: arg.written, value, how: at.how, mode, bases: at.bases, search: at.search, same_process: at.same_process, literal: literal(value, at.step.text), child: at.child, inputs });
};

const script = (at: Launcher, arg: Arg, language: SourceLanguage | null = null): void => {
  if ("unresolved" in arg.value) {
    unresolved_gap(at.refs, arg.written, arg.value);
    return;
  }
  const files = arg.value.values.filter((entry) => !/[*?]/.test(entry) && script_extension.test(entry));
  const entries = arg.value.values.filter((entry) => !files.includes(entry));
  if (files.length) launch({ ...at, bases: [at.child], same_process: false }, arg, "script", resolved(files));
  if (entries.length) at.refs.entries.push({ written: arg.written, value: resolved(entries), location: at.child, language });
};

const module_call = (at: Launcher, kind: ModuleRef["kind"], arg: Arg | undefined, rest: Arg[]): void => {
  if (arg && "unresolved" in arg.value) {
    unresolved_gap(at.refs, arg.written, arg.value);
    return;
  }
  const args = rest.map((entry) => entry.value);
  for (const spec of arg && "values" in arg.value ? arg.value.values : [""]) at.refs.modules.push({ module: { kind, spec }, location: at.child, args });
  if (kind === "python" && arg && /^pip\d*$/.test(single(arg.value) ?? "")) at.refs.builds.push(...local_build_dirs(rest).map((dir) => ({ dir, location: at.child })));
};

const code_flag = (program: string, raw: string): boolean => {
  if (/^(?:python|py)/.test(program)) return raw === "-c";
  if (/^(?:node|tsx|ts-node)$/.test(program)) return /^(?:-e|--eval|-p|--print)$/.test(raw);
  if (program === "bash" || program === "sh") return raw === "-c";
  return raw === "-e" || (program === "php" && raw === "-r");
};

const powershell_interpreter = (args: Arg[], at: Launcher): void => {
  for (let index = 0; index < args.length; index += 1) {
    const name = powershell_switch(single(args[index]?.value) ?? "");
    const next = args[index + 1];
    if (!name) {
      script(at, args[index] as Arg);
      return;
    }
    if ("command".startsWith(name) || name === "ec" || "encodedcommand".startsWith(name)) return;
    if ("file".startsWith(name)) {
      if (next) script(at, next);
      else at.refs.gaps.push("Script interpreter has no file argument.");
      return;
    }
    if (powershell_takes_value(name)) index += 1;
  }
};

const interpreter = (program: string, args: Arg[], at: Launcher): void => {
  if (program === "powershell" || program === "pwsh") {
    powershell_interpreter(args, at);
    return;
  }
  const python = /^(?:python|py)/.test(program);
  const node = /^(?:node|tsx|ts-node)$/.test(program);
  let parse_only = false;
  for (let index = 0; index < args.length; index += 1) {
    const raw = single(args[index]?.value) ?? "";
    const next = args[index + 1];
    if (syntax_check(program, raw)) {
      parse_only = true;
      continue;
    }
    if (code_flag(program, raw)) {
      if (program === "bash" || program === "sh") return;
      if (next) at.refs.code.push({ written: next.written, value: next.value, dialect: null, language: python ? "python" : node ? "js" : null, location: at.child });
      else at.refs.gaps.push(`Payload could not be resolved: ${program} ${raw} (no payload)`);
      return;
    }
    if (python && raw === "-m") {
      module_call(at, "python", next, args.slice(index + 2));
      return;
    }
    if (node && node_preloads.test(raw)) {
      module_call(at, "node", next, []);
      index += 1;
      continue;
    }
    if ((python && python_values.has(raw)) || (node && node_values.has(raw))) {
      index += 1;
      continue;
    }
    if (raw.startsWith("-")) continue;
    if (!parse_only) script(at, args[index] as Arg, python ? "python" : node ? "js" : null);
    return;
  }
  if (program === "node" && args.some((arg) => flag_of(arg) === "--test")) at.refs.discovery.push({ location: at.child, language: "js", runner: "node", paths: [] });
};

const runner_value_flag = /^(?:-p|--package|--with|--python|--project|--directory|--from)$/;

const runner_rest = (program: string, args: Arg[]): Arg[] | null => {
  const second = flag_of(args[0]);
  const skip = program === "npx" ? 0 : (program === "pnpm" && (second === "exec" || second === "dlx")) || (program === "yarn" && second === "exec") || (program === "uv" && second === "run") ? 1 : -1;
  if (skip < 0) {
    return null;
  }
  let index = skip;
  while (index < args.length && flag_of(args[index]).startsWith("-")) {
    index += runner_value_flag.test(flag_of(args[index])) ? 2 : 1;
  }
  return args.slice(index);
};

const dispatch = (argv: Arg[], at: Launcher): void => {
  const [head, ...args] = argv;
  if (!head) return;
  const program = program_of(head.value);
  launch(at, head, "command", head.value, argument_inputs(args, at.step.dialect));
  const rest = runner_rest(program, args);
  if (rest) {
    if (program !== "uv") at.refs.discovery.push({ location: at.child, language: "js", runner: null, paths: [] });
    launched(rest, { ...at, search: "none", same_process: false });
    return;
  }
  if (package_manager.test(program) && !/[\\/]/.test(head.written)) {
    const found = package_call(args, program);
    at.refs.gaps.push(...found.gaps);
    at.refs.package = found.call;
  }
  if (/^pip\d*(?:\.\d+)?$/.test(program)) at.refs.builds.push(...local_build_dirs(args).map((dir) => ({ dir, location: at.child })));
  if (interpreter_name.test(program)) interpreter(program, args, at);
};

const launched = (argv: Arg[], at: Launcher): void => {
  const head = argv[0];
  if (!head) return;
  if (!shell_program.test(program_of(head.value))) {
    dispatch(argv, at);
    return;
  }
  at.refs.code.push({ written: argv.map((arg) => arg.written).join(" "), value: command_line(argv), dialect: "cmd", language: null, location: at.child });
};

const module_import = (args: Arg[], at: Launcher): void => {
  const named = args.findIndex((arg) => /^-n(?:a(?:me?)?)?$/i.test(arg.written));
  const target = named >= 0 ? args[named + 1] : args.find((arg) => !arg.written.startsWith("-"));
  for (const part of target?.parts ?? []) {
    if ("unresolved" in part) {
      unresolved_gap(at.refs, target?.written ?? "", part);
      continue;
    }
    const paths = part.values.filter((entry) => /[\\/]/.test(entry) || /\.psm?1$/i.test(entry));
    const scripts = paths.filter((entry) => /\.psm?1$/i.test(entry));
    if (paths.length > scripts.length) at.refs.gaps.push(launch_gap(target?.written ?? "", "module folder or manifest not read"));
    if (scripts.length) launch({ ...at, how: "Import-Module" }, target as Arg, "path", resolved(scripts));
  }
};

const start_process = (args: Arg[], at: Launcher): void => {
  const positional: Arg[] = [];
  const found: Record<string, Arg | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as Arg;
    const flag = /^-(\w+):?$/.exec(arg.written)?.[1]?.toLowerCase();
    if (!flag) {
      positional.push(arg);
      continue;
    }
    const takes = (name: string, least: number) => flag.length >= least && name.startsWith(flag);
    const slot = takes("filepath", 1) || flag === "pspath" || flag === "path" ? "file" : takes("argumentlist", 1) || flag === "args" ? "list" : takes("workingdirectory", 2) ? "working" : takes("verb", 1) ? "verb" : "";
    if (!slot && !takes("credential", 1) && !takes("windowstyle", 2) && !/^(?:redirectstandard\w+|rs[eio])$/.test(flag)) continue;
    if (slot) found[slot] = args[index + 1];
    index += 1;
  }
  const file = found.file ?? positional[0];
  if (!file) return;
  const folder = found.working ? against_location(found.working.value, at.step.location) : null;
  const where = single(folder ?? undefined) ?? found.working?.written ?? "";
  if (found.working) at.refs.notes.push(`Start-Process ${file.written} runs in working directory ${where}`);
  if (found.verb) at.refs.notes.push(`Start-Process ${file.written} uses -Verb ${found.verb.written}`);
  const how = found.working ? `Start-Process, working directory ${where}` : "Start-Process";
  const bases = folder ? [at.step.location, folder] : [at.step.location];
  launched([file, ...argument_list(found.list ?? positional[1])], { ...at, how, bases, child: folder ?? at.step.location, search: "location_then_path", same_process: false });
};

const invoke_item = (args: Arg[], at: Launcher): void => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as Arg;
    const flag = /^-(\w+):?$/.exec(arg.written)?.[1]?.toLowerCase();
    const path_flag = flag !== undefined && /^(?:path|literalpath|lp|pspath)$/.test(flag);
    if (flag && !path_flag) {
      if (/^(?:filter|include|exclude|credential)$/.test(flag)) index += 1;
      continue;
    }
    const target = path_flag ? args[++index] : arg;
    if (target) launch({ ...at, how: "Invoke-Item", search: "none", same_process: false }, target, "path");
  }
};

const cmd_start = (args: Arg[], at: Launcher): void => {
  let index = args[0]?.quoted ? 1 : 0;
  let working: Value | null = null;
  for (; index < args.length; index += 1) {
    const text = args[index]?.written ?? "";
    if (!text.startsWith("/")) break;
    if (/^\/d$/i.test(text)) working = args[++index]?.value ?? null;
    else if (/^\/d/i.test(text)) working = resolved([text.slice(2)]);
    else if (/^\/(?:node|affinity)$/i.test(text)) index += 1;
  }
  const folder = working ? against_location(working, at.step.location) : null;
  launched(args.slice(index), { ...at, how: "start", bases: [folder ?? at.step.location], child: folder ?? at.step.location, search: "location_then_path", same_process: false });
};

const process_start = (at: Launcher, initial: Value): void => {
  const words = at.step.words;
  for (const [index, entry] of words.entries()) {
    if (!/\[(?:system\.)?diagnostics\.process\]::start$/i.test(entry.word.raw)) continue;
    const call = words[index + 1];
    const written = entry.word.raw + (call?.word.raw ?? "");
    const [file, list] = call?.word.glued ? (call.items ?? []) : [];
    if (!file) {
      at.refs.gaps.push(launch_gap(written, "expression not evaluated"));
      continue;
    }
    const target = "values" in file && file.list ? unresolved("not a string") : file;
    const argv = [{ written, value: target, parts: [target], quoted: false }, ...argument_list(list && { written, value: list, parts: [list], quoted: false })];
    launched(argv, { ...at, how: "Process.Start", bases: [initial, at.step.location], search: "location_then_path", same_process: false });
  }
};

const job_file = (name: string, args: Arg[], at: Launcher): void => {
  for (let index = 0; index < args.length; index += 1) {
    const flag = /^-(\w+):?$/.exec(args[index]?.written ?? "")?.[1]?.toLowerCase() ?? "";
    const file = flag && ("filepath".startsWith(flag) || flag === "pspath" || (flag.length > 1 && "literalpath".startsWith(flag)));
    const next = args[index + 1];
    if (file && next) script({ ...at, how: name }, next);
  }
};

export const step_refs = (step: Step, initial: Value): StepRefs => {
  const refs: StepRefs = { launches: [], code: [], entries: [], modules: [], package: null, discovery: [], builds: [], named: [], runtime: false, gaps: [], notes: [] };
  const at: Launcher = { step, refs, how: "", bases: [step.location], child: step.location, search: step.search, same_process: step.in_process };
  if (step.dialect === "powershell") process_start(at, initial);
  const args = args_of(step.words);
  const index = step.command ? head_index(step, args) : args.length;
  const head = args[index];
  const named = () => args.slice(step.command ? index + 1 : 0).filter((arg) => !refs.launches.some((launch) => launch.written === arg.written)).flatMap((arg) => arg.parts);
  if (!head) return { ...refs, named: named() };
  const name = index === 0 ? flag_of(head).replace(/^@+/, "") : "";
  const powershell = step.dialect === "powershell";
  if (powershell && (name === "iex" || name === "invoke-expression")) refs.runtime = true;
  else if (powershell && /^(?:import-module|ipmo)$/.test(name)) module_import(args.slice(1), at);
  else if (powershell && name === "using" && flag_of(args[1]) === "module") module_import(args.slice(2), at);
  else if (powershell && /^(?:start-process|saps|start)$/.test(name)) start_process(args.slice(1), at);
  else if (powershell && /^(?:invoke-item|ii)$/.test(name)) invoke_item(args.slice(1), at);
  else if (powershell && /^(?:start-job|sajb|start-threadjob|invoke-command|icm)$/.test(name)) job_file(head.written, args.slice(1), at);
  else if (step.dialect === "cmd" && name === "start") cmd_start(args.slice(1), at);
  else dispatch(args.slice(index), at);
  return { ...refs, named: named() };
};

import { resolved, type Value } from "./command-walk.ts";
import { launch_gap } from "./launch-targets.ts";

export type PackageCall = { name: string; ignore_scripts: boolean; lifecycle: boolean; prefix: Value | null };

type CallArg = { written: string; value: Value };

const lifecycle_verbs = /^(?:install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|ci|clean-install|ic|install-clean|isntall-clean)$/;

const prefix_flags = /^(?:--prefix|-C|--dir|--cwd)$/;

const value_flags = /^(?:--prefix|-C|--dir|--cwd|--userconfig|--cache|--loglevel|--registry|--filter|-F)$/;

const pip_value_flags = /^(?:-r|--requirement|-c|--constraint|-i|--index-url|--extra-index-url|-f|--find-links|-t|--target|--prefix|--root|--src|--upgrade-strategy|--python-version|--platform|--implementation|--abi|--no-binary|--only-binary|--progress-bar|--log|--proxy|--retries|--timeout|--exists-action|--trusted-host|--cert|--client-cert|--cache-dir|--global-option|--config-settings|-C)$/;

const local_path = /^(?:\.{1,2}(?:[\\/]|$)|[A-Za-z]:[\\/]|[\\/])|^[^:]*[\\/]/;

const single = (value: Value | undefined): string | null => (value && "values" in value && value.values.length === 1 && !value.list ? (value.values[0] ?? null) : null);

export const package_call = (args: CallArg[], manager: string): { call: PackageCall | null; gaps: string[] } => {
  let index = 0;
  let prefix: Value | null = null;
  for (; index < args.length; index += 1) {
    const raw = single(args[index]?.value) ?? "";
    if (!raw.startsWith("-")) break;
    if (/^(?:-w|--workspace)(?:=|$)/.test(raw)) return { call: null, gaps: [`Package workspace scripts were not inspected: ${args.map((arg) => arg.written).join(" ")}`] };
    const glued = /^--(?:prefix|dir|cwd)=(.+)$/.exec(raw);
    if (glued) prefix = resolved([glued[1] ?? ""]);
    else if (prefix_flags.test(raw)) prefix = args[index + 1]?.value ?? null;
    if (value_flags.test(raw)) index += 1;
  }
  const verb = (single(args[index]?.value) ?? "").toLowerCase();
  const ignore_scripts = args.some((arg) => single(arg.value) === "--ignore-scripts");
  if (lifecycle_verbs.test(verb) || (!verb && index >= args.length && manager === "yarn")) return { call: { name: "install", ignore_scripts, lifecycle: true, prefix }, gaps: [] };
  const rest = args.slice(index + 1);
  const named = verb === "run" || verb === "run-script" ? rest.find((arg) => !(single(arg.value) ?? "").startsWith("-")) : /^(?:test|build|start)$/.test(verb) ? args[index] : undefined;
  if (!named) return { call: null, gaps: [] };
  if ("unresolved" in named.value) return { call: null, gaps: [launch_gap(named.written, named.value.unresolved)] };
  const name = single(named.value);
  return { call: name ? { name, ignore_scripts, lifecycle: false, prefix } : null, gaps: [] };
};

export const local_build_dirs = (args: CallArg[]): Value[] => {
  if (single(args[0]?.value) !== "install") return [];
  const dirs: Value[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const raw = single(args[index]?.value) ?? "";
    if (pip_value_flags.test(raw)) {
      index += 1;
      continue;
    }
    const editable = raw === "-e" || raw === "--editable";
    const value = editable ? args[index + 1]?.value : args[index]?.value;
    if (editable) index += 1;
    if (!value || (!editable && raw.startsWith("-"))) continue;
    if ("unresolved" in value ? editable : value.values.some((entry) => local_path.test(entry) && !/:\/\//.test(entry))) dirs.push(value);
  }
  return dirs;
};

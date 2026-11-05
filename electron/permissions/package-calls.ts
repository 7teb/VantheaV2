import { resolved, type Value } from "./command-walk.ts";
import { launch_gap } from "./launch-targets.ts";
import { npm_command } from "./npm-command.ts";

export type PackageCall = { name: string; ignore_scripts: boolean; lifecycle: boolean; prefix: Value | null; test?: boolean };

type CallArg = { written: string; value: Value };

const lifecycle_verbs = /^(?:install|i|in|ins|inst|insta|instal|isnt|isnta|isntal|isntall|add|ci|clean-install|ic|install-clean|isntall-clean)$/;

const prefix_flags = /^(?:--prefix|-C|--dir|--cwd)$/;

const value_flags = /^(?:--prefix|-C|--dir|--cwd|--userconfig|--cache|--loglevel|--registry|--filter|-F)$/;

const pip_value_flags = /^(?:-r|--requirement|-c|--constraint|-i|--index-url|--extra-index-url|-f|--find-links|-t|--target|--prefix|--root|--src|--upgrade-strategy|--python-version|--platform|--implementation|--abi|--no-binary|--only-binary|--progress-bar|--log|--proxy|--retries|--timeout|--exists-action|--trusted-host|--cert|--client-cert|--cache-dir|--global-option|--config-settings|-C)$/;

const local_path = /^(?:\.{1,2}(?:[\\/]|$)|[A-Za-z]:[\\/]|[\\/])|^[^:]*[\\/]/;

const yarn_commands = /^(?:add|audit|autoclean|bin|cache|check|config|constraints|create|dedupe|dlx|exec|generate-lock-entry|global|help|import|info|init|install|licenses|link|list|login|logout|node|npm|outdated|owner|pack|patch|patch-commit|plugin|policies|publish|rebuild|remove|search|self-update|set|tag|team|unlink|unplug|up|upgrade|upgrade-interactive|version|versions|why|workspace|workspaces)$/;

const pnpm_commands = /^(?:add|approve-builds|audit|bin|cache|catalog|config|create|dedupe|deploy|dlx|doctor|env|exec|explain|fetch|help|import|init|install|link|list|login|logout|ls|outdated|pack|patch|patch-commit|patch-remove|pm|prefix|prune|publish|rebuild|remove|root|self-update|server|setup|store|unlink|update|up|version|view|why)$/;

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
  const written = single(args[index]?.value) ?? "";
  const verb = manager === "npm" ? npm_command(written) : written.toLowerCase();
  const ignore_scripts = args.some((arg) => single(arg.value) === "--ignore-scripts");
  if (manager === "npm" && /^(?:it|cit|sit|install-test|install-ci-test|clean-install-test)$/.test(verb)) return { call: { name: "install", ignore_scripts, lifecycle: true, prefix, test: true }, gaps: [] };
  if (lifecycle_verbs.test(verb) || (!verb && index >= args.length && manager === "yarn")) return { call: { name: "install", ignore_scripts, lifecycle: true, prefix }, gaps: [] };
  const rest = args.slice(index + 1);
  const run = /^(?:run|run-script)$/.test(verb);
  const shorthand = manager === "yarn" ? !yarn_commands.test(verb) : manager === "pnpm" && !pnpm_commands.test(verb);
  const script_arg = (): CallArg | undefined => {
    if (run) return rest.find((arg) => !(single(arg.value) ?? "").startsWith("-"));
    return /^(?:test|build|start|stop|restart)$/.test(verb) || shorthand ? args[index] : undefined;
  };
  const named = script_arg();
  if (!named) return { call: null, gaps: [] };
  if ("unresolved" in named.value) return { call: null, gaps: [launch_gap(named.written, named.value.unresolved)] };
  const script_name = (arg: CallArg): string | null => {
    if (manager === "npm" && !run) return verb;
    return manager === "pnpm" && !run && /^(?:t|tst)$/.test(written) ? "test" : single(arg.value);
  };
  const name = script_name(named);
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

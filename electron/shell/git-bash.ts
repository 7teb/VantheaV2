import path from "node:path";

type Env = Record<string, string | undefined>;

export type GitBashProbe = {
  install_path: (key: string) => Promise<string | null>;
  exists: (file: string) => boolean;
  env: Env;
};

const registry_keys = ["HKLM\\SOFTWARE\\GitForWindows", "HKCU\\SOFTWARE\\GitForWindows"];

const git_exe_dir = /[\\/](?:cmd|bin|mingw64[\\/]bin|mingw32[\\/]bin|clangarm64[\\/]bin)[\\/]*$/i;

let located: string | null = null;

const env_key = (env: Env, name: string): string | undefined => Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());

const env_of = (env: Env, name: string): string | null => {
  const key = env_key(env, name);
  return key === undefined ? null : env[key] || null;
};

const bash_in = (root: string, exists: (file: string) => boolean): string | null => {
  const bash = path.win32.join(root, "bin", "bash.exe");
  return exists(bash) && exists(path.win32.join(root, "usr", "bin", "bash.exe")) ? bash : null;
};

const path_roots = (probe: GitBashProbe): string[] =>
  (env_of(probe.env, "PATH") ?? "")
    .split(";")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((dir) => dir && probe.exists(path.win32.join(dir, "git.exe")))
    .flatMap((dir) => {
      const match = git_exe_dir.exec(dir);
      return match ? [dir.slice(0, match.index)] : [];
    });

const standard_roots = (env: Env): string[] => {
  const places: [string | null, string][] = [
    [env_of(env, "ProgramW6432"), "Git"],
    [env_of(env, "ProgramFiles"), "Git"],
    [env_of(env, "ProgramFiles(x86)"), "Git"],
    [env_of(env, "LOCALAPPDATA"), "Programs\\Git"],
  ];
  return places.flatMap(([base, rest]) => (base ? [path.win32.join(base, rest)] : []));
};

export const locate_git_bash = async (probe: GitBashProbe): Promise<string | null> => {
  for (const key of registry_keys) {
    const root = await probe.install_path(key);
    const bash = root ? bash_in(root, probe.exists) : null;
    if (bash) {
      return bash;
    }
  }
  for (const root of [...path_roots(probe), ...standard_roots(probe.env)]) {
    const bash = bash_in(root, probe.exists);
    if (bash) {
      return bash;
    }
  }
  return null;
};

export const init_git_bash = async (probe: GitBashProbe): Promise<void> => {
  located = await locate_git_bash(probe);
};

export const git_bash_path = (): string | null => located;

export const git_bash_root = (): string | null => (located ? path.win32.dirname(path.win32.dirname(located)) : null);

export const bash_env = (env: Env): Env => {
  const root = git_bash_root();
  if (!root) {
    return env;
  }
  const key = env_key(env, "PATH") ?? "PATH";
  const home = env_of(env, "HOME") ?? env_of(env, "USERPROFILE");
  const dirs = [path.win32.join(root, "mingw64", "bin"), path.win32.join(root, "usr", "bin"), ...(home ? [path.win32.join(home, "bin")] : []), env[key] ?? ""];
  return { ...env, [key]: dirs.filter(Boolean).join(";") };
};

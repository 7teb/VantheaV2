import assert from "node:assert/strict";
import { test } from "node:test";
import { bash_env, git_bash_path, git_bash_root, init_git_bash, locate_git_bash, type GitBashProbe } from "../electron/shell/git-bash.ts";
import { bash_args, shell_exit, signal_note } from "../electron/shell/process.ts";

const installed = (...roots: string[]) => new Set(roots.flatMap((root) => [`${root}\\bin\\bash.exe`, `${root}\\usr\\bin\\bash.exe`]));

const probe = (files: Set<string>, env: Record<string, string>, registry: Record<string, string> = {}): GitBashProbe => ({
  install_path: async (key) => registry[key] ?? null,
  exists: (file) => files.has(file),
  env,
});

test("the registry install path wins and the bin launcher is used", async () => {
  const files = installed("D:\\Tools\\Git", "C:\\Program Files\\Git");
  const found = await locate_git_bash(probe(files, { ProgramFiles: "C:\\Program Files" }, { "HKCU\\SOFTWARE\\GitForWindows": "D:\\Tools\\Git" }));
  assert.equal(found, "D:\\Tools\\Git\\bin\\bash.exe");
});

test("git.exe on PATH leads to its install root, and a WSL bash.exe on PATH is never taken", async () => {
  const files = new Set([...installed("E:\\PortableGit"), "E:\\PortableGit\\cmd\\git.exe", "C:\\Windows\\System32\\bash.exe"]);
  const env = { Path: "C:\\Windows\\System32;\"E:\\PortableGit\\cmd\"" };
  assert.equal(await locate_git_bash(probe(files, env)), "E:\\PortableGit\\bin\\bash.exe");
  const mingw = new Set([...installed("F:\\Git"), "F:\\Git\\mingw64\\bin\\git.exe"]);
  assert.equal(await locate_git_bash(probe(mingw, { PATH: "F:\\Git\\mingw64\\bin" })), "F:\\Git\\bin\\bash.exe");
  assert.equal(await locate_git_bash(probe(new Set(["C:\\Windows\\System32\\bash.exe"]), { PATH: "C:\\Windows\\System32" })), null);
});

test("the standard install folders are the fallback and a root without usr\\bin\\bash.exe is skipped", async () => {
  const user = installed("C:\\Users\\me\\AppData\\Local\\Programs\\Git");
  assert.equal(await locate_git_bash(probe(user, { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" })), "C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe");
  const half = new Set(["C:\\Program Files\\Git\\bin\\bash.exe"]);
  assert.equal(await locate_git_bash(probe(half, { ProgramFiles: "C:\\Program Files" })), null);
});

test("the located bash sets the root and puts the Git folders first on the walker PATH", async () => {
  await init_git_bash(probe(installed("C:\\Git"), {}, { "HKLM\\SOFTWARE\\GitForWindows": "C:\\Git" }));
  assert.equal(git_bash_path(), "C:\\Git\\bin\\bash.exe");
  assert.equal(git_bash_root(), "C:\\Git");
  const env = bash_env({ Path: "C:\\Windows", USERPROFILE: "C:\\Users\\me" });
  assert.equal(env.Path, "C:\\Git\\mingw64\\bin;C:\\Git\\usr\\bin;C:\\Users\\me\\bin;C:\\Windows");
  await init_git_bash(probe(new Set(), {}));
  assert.equal(git_bash_path(), null);
  assert.deepEqual(bash_env({ Path: "C:\\Windows" }), { Path: "C:\\Windows" });
});

test("bash exit codes decode MSYS signal terminations to 128 plus the signal", () => {
  assert.deepEqual(shell_exit("bash", 3, null), { exit_code: 3, signal: null });
  assert.deepEqual(shell_exit("bash", 15 * 256, null), { exit_code: 143, signal: "SIGTERM" });
  assert.deepEqual(shell_exit("bash", 9 * 256, null), { exit_code: 137, signal: "SIGKILL" });
  assert.deepEqual(shell_exit("bash", 40 * 256, null), { exit_code: 168, signal: "signal 40" });
  assert.deepEqual(shell_exit("bash", 3221225477, null), { exit_code: 3221225477, signal: null });
  assert.deepEqual(shell_exit("powershell", 3840, null), { exit_code: 3840, signal: null });
  assert.deepEqual(shell_exit("powershell", null, "SIGTERM"), { exit_code: null, signal: "SIGTERM" });
  assert.equal(signal_note("SIGTERM"), "[the shell was terminated by SIGTERM]");
});

test("the bash -c argument escapes backslashes and quotes for the MSYS command line", () => {
  const [flag, script] = bash_args('echo "a\\b" C:\\\\x');
  assert.equal(flag, "-c");
  assert.ok(script?.startsWith('"chcp.com 65001'));
  assert.ok(script?.endsWith('\necho \\"a\\\\b\\" C:\\\\\\\\x"'));
});

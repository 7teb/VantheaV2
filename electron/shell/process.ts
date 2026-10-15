import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { ShellKind } from "../../shared/shell.ts";
import { git_bash_path } from "./git-bash.ts";

export type ShellSpawner = (command: string, cwd: string) => ChildProcess;

export type ShellExit = { exit_code: number | null; signal: string | null };

export const exit_grace_ms = 2000;

const utf8_prelude = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.UTF8Encoding]::new($false) # UTF-8 output setup added by VantheaX, not part of the command\n";

const exit_code_footer = `if (-not $?) { Set-StrictMode -Off; if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { $host.SetShouldExit($LASTEXITCODE) } elseif ("$($Error[0].FullyQualifiedErrorId)" -notlike 'NativeCommandError*') { $host.SetShouldExit(1) } } # exit code handling added by VantheaX, not part of the command`;

const bash_prelude = "chcp.com 65001 >/dev/null 2>&1 # UTF-8 output setup for Windows programs added by VantheaX, not part of the command\n";

const msys_signals = ["", "SIGHUP", "SIGINT", "SIGQUIT", "SIGILL", "SIGTRAP", "SIGABRT", "SIGEMT", "SIGFPE", "SIGKILL", "SIGBUS", "SIGSEGV", "SIGSYS", "SIGPIPE", "SIGALRM", "SIGTERM", "SIGURG", "SIGSTOP", "SIGTSTP", "SIGCONT", "SIGCHLD", "SIGTTIN", "SIGTTOU", "SIGIO", "SIGXCPU", "SIGXFSZ", "SIGVTALRM", "SIGPROF", "SIGWINCH", "SIGPWR", "SIGUSR1", "SIGUSR2"];

export const powershell_args = (command: string): string[] => ["-NoProfile", "-NonInteractive", "-Command", `${utf8_prelude}${command}\n;\n${exit_code_footer}`];

const msys_quoted = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const bash_args = (command: string): string[] => ["-c", msys_quoted(`${bash_prelude}${command}`)];

const piped = (child: ChildProcess, shell: string, cwd: string): ChildProcess => {
  child.stdin?.on("error", (error) => console.warn(`[shell] stdin of ${shell} in ${cwd} failed: ${error.message}`));
  child.stdin?.end();
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  return child;
};

export const spawn_powershell: ShellSpawner = (command, cwd) =>
  piped(spawn("powershell.exe", powershell_args(command), { cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }), "powershell", cwd);

export const spawn_bash: ShellSpawner = (command, cwd) => {
  const bash = git_bash_path();
  if (!bash) {
    throw new Error("Git Bash was not found on this PC");
  }
  const child = spawn(bash, bash_args(command), { cwd, windowsHide: true, shell: false, windowsVerbatimArguments: true, argv0: `"${bash}"`, stdio: ["pipe", "pipe", "pipe"] });
  return piped(child, "bash", cwd);
};

export const shell_spawners: Record<ShellKind, ShellSpawner> = { powershell: spawn_powershell, bash: spawn_bash };

export const shell_exit = (shell: ShellKind, code: number | null, signal: string | null): ShellExit => {
  if (code === null) {
    return { exit_code: null, signal };
  }
  const number = code / 256;
  if (shell === "bash" && Number.isInteger(number) && number >= 1 && number <= 64) {
    return { exit_code: 128 + number, signal: msys_signals[number] ?? `signal ${number}` };
  }
  return { exit_code: code, signal: null };
};

export const signal_note = (signal: string): string => `[the shell was terminated by ${signal}]`;

const taskkill_args = (pid: number) => ["/PID", String(pid), "/T", "/F"];

export const kill_tree = (pid: number | null | undefined) => {
  if (!pid) {
    return;
  }
  const killer = spawn("taskkill.exe", taskkill_args(pid), { windowsHide: true, shell: false, stdio: "ignore" });
  killer.on("error", (error) => console.warn(`[shell] taskkill for pid ${pid} failed: ${error.message}`));
};

export const kill_tree_sync = (pid: number | null | undefined) => {
  if (!pid) {
    return;
  }
  const result = spawnSync("taskkill.exe", taskkill_args(pid), { windowsHide: true, shell: false, stdio: "ignore", timeout: 5000 });
  if (result.error) {
    console.warn(`[shell] taskkill for pid ${pid} failed: ${result.error.message}`);
  }
};

export const strip_ansi = (text: string): string =>
  text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1B[()][AB0-2]/g, "")
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

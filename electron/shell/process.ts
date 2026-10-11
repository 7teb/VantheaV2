import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const utf8_prelude = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.UTF8Encoding]::new($false) # UTF-8 output setup added by VantheaX, not part of the command\n";

const exit_code_footer = `if (-not $?) { Set-StrictMode -Off; if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { $host.SetShouldExit($LASTEXITCODE) } elseif ("$($Error[0].FullyQualifiedErrorId)" -notlike 'NativeCommandError*') { $host.SetShouldExit(1) } } # exit code handling added by VantheaX, not part of the command`;

export const powershell_args = (command: string): string[] => ["-NoProfile", "-NonInteractive", "-Command", `${utf8_prelude}${command}\n;\n${exit_code_footer}`];

export const spawn_powershell = (command: string, cwd: string): ChildProcess => {
  const child = spawn("powershell.exe", powershell_args(command), { cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin?.on("error", (error) => console.warn(`[shell] stdin of powershell in ${cwd} failed: ${error.message}`));
  child.stdin?.end();
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  return child;
};

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

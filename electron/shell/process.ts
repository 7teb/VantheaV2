import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const utf8_prelude = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ";

export const powershell_args = (command: string): string[] => ["-NoProfile", "-NonInteractive", "-Command", `${utf8_prelude}${command}`];

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

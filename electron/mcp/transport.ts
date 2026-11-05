import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";

const run_cleanup = (command: string, args: string[]): Promise<number | null> => new Promise((resolve) => {
  const killer = spawn(command, args, { windowsHide: true, stdio: "ignore" });
  killer.once("error", (error) => {
    console.warn(`[mcp] process cleanup with ${command} failed: ${error.message}`);
    resolve(null);
  });
  killer.once("exit", (code) => resolve(code));
});

const kill_tree = async (pid: number): Promise<void> => {
  if (await run_cleanup("taskkill.exe", ["/PID", String(pid), "/T", "/F"]) === 0) return;
  const script = `$items = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId); $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add(${pid}); for ($index = 0; $index -lt $ids.Count; $index++) { foreach ($item in $items) { if ($item.ParentProcessId -eq $ids[$index] -and -not $ids.Contains([int]$item.ProcessId)) { $ids.Add([int]$item.ProcessId) } } }; for ($index = $ids.Count - 1; $index -ge 1; $index--) { Stop-Process -Id $ids[$index] -Force -ErrorAction SilentlyContinue }`;
  if (await run_cleanup("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]) !== 0) {
    console.warn(`[mcp] cleaning descendants of exited server pid ${pid} failed`);
  }
};

export class TreeTransport extends StdioClientTransport {
  private closing: Promise<void> | null = null;
  private process_id: number | null = null;

  override async start(): Promise<void> {
    await super.start();
    this.process_id = this.pid;
  }

  override close(): Promise<void> {
    if (this.closing) return this.closing;
    const pid = this.pid ?? this.process_id;
    this.closing = (async () => {
      if (pid && process.platform === "win32") {
        await kill_tree(pid);
      }
      await super.close();
    })();
    return this.closing;
  }
}

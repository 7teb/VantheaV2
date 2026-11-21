import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

export const expect = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

export const with_timeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms / 1000} s`)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const alive = (pid) => {
  try {
    return process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
    return false;
  }
};

const windows_script = `Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class VxSmokeWindows {
  public delegate bool EachWindow(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EachWindow each, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  public static string[] List(uint wanted) {
    var found = new List<string>();
    EnumWindows(delegate (IntPtr window, IntPtr data) {
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid == wanted) { var name = new StringBuilder(256); GetClassName(window, name, name.Capacity); found.Add((IsWindowVisible(window) ? "visible " : "hidden ") + name); }
      return true;
    }, IntPtr.Zero);
    return found.ToArray(); } }
'@
ConvertTo-Json -Compress -InputObject @([VxSmokeWindows]::List([uint32]$env:VX_SMOKE_PID))`;

export const windows_of = (pid) => {
  const encoded = Buffer.from(windows_script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8", env: { ...process.env, VX_SMOKE_PID: String(pid) }, windowsHide: true });
  expect(result.status === 0, `the window listing exited with ${result.status}: ${(result.stderr || "").trim().slice(-600)}`);
  return JSON.parse(result.stdout.trim() || "[]");
};

export const create_run = ({ temp, system_temp, log_file }) => {
  const junctions = [];
  const spawned = [];

  const ready_lines = () =>
    (fs.existsSync(log_file) ? fs.readFileSync(log_file, "utf8").split(/\r?\n/) : []).filter((line) => line.startsWith('{"vantheax":"ready"')).map((line) => JSON.parse(line));

  const own_pids = () => [...new Set([...ready_lines().map((entry) => entry.pid), ...spawned.map((child) => child.pid)])].filter((pid) => pid && alive(pid));

  const start = (command, args, env) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    spawned.push(child);
    const output = { stdout: "", stderr: "" };
    child.stdout.on("data", (text) => (output.stdout += text));
    child.stderr.on("data", (text) => (output.stderr += text));
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, ...output }));
    });
    return { child, output, wait: (ms, label) => with_timeout(exited, ms, label) };
  };

  const link = (target, at) => {
    fs.symlinkSync(target, at, "junction");
    junctions.push(at);
  };

  const remove_temp = async () => {
    for (const at of junctions.reverse()) {
      if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) {
        fs.unlinkSync(at);
      }
    }
    const kept = junctions.filter((at) => fs.existsSync(at));
    expect(kept.length === 0, `the junctions ${kept.join(", ")} are still there, so ${temp} stays in place`);
    await fs.promises.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  };

  const cleanup = async (state) => {
    if (state.vx) {
      await with_timeout(state.vx.close(), 30_000, "close() during cleanup").catch((error) => console.error(`[smoke] ${error.message}`));
    }
    for (const pid of own_pids()) {
      console.error(`[smoke] stopping the leftover process ${pid} of this run`);
      process.kill(pid);
    }
    await state.fake?.close();
    try {
      await remove_temp();
    } catch (error) {
      console.error(`[smoke] removing ${temp} failed: ${error.message}`);
    }
    const leftovers = fs.readdirSync(system_temp).filter((name) => name.startsWith("vx-tmp-headless-"));
    if (leftovers.length) {
      console.error(`[smoke] leftover temp folders in ${system_temp}: ${leftovers.join(", ")}`);
    }
  };

  return { ready_lines, own_pids, start, link, cleanup };
};

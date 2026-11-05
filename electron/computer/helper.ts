import { spawn, type ChildProcess } from "node:child_process";
import { kill_tree, kill_tree_sync } from "../shell/process.ts";
import { native_source } from "./native.ts";
import { input_source } from "./native-input.ts";
import { loop_source } from "./native-loop.ts";

type Pending = { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void };
export type HelperRequest = { op: string; [key: string]: unknown };
export type HelperSpawn = (script: string) => ChildProcess;

export const helper_script = (owner: number) => `$ErrorActionPreference='Stop'\nAdd-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms,System.Web.Extensions -TypeDefinition @'\n${native_source}${input_source}${loop_source}\n'@\n[VantheaXComputer]::Run(${owner})`;

const start_helper: HelperSpawn = (script) => {
  const bootstrap = "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine())))";
  const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", bootstrap], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin?.write(`${Buffer.from(script).toString("base64")}\n`);
  return child;
};

export class ComputerHelper {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending | null = null;
  private sequence = 0;
  private start_failure: ((error: Error) => void) | null = null;
  private spawn: HelperSpawn;
  private kill: (pid: number | undefined) => void;

  constructor(spawner: HelperSpawn = start_helper, killer = kill_tree) {
    this.spawn = spawner;
    this.kill = killer;
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = new Promise<void>((resolve, reject) => {
      const child = this.spawn(helper_script(process.pid));
      this.child = child;
      let output = "";
      let errors = "";
      let started = false;
      const fail = (error: Error) => {
        clearTimeout(timer);
        if (this.child !== child) return;
        this.child = null;
        this.ready = null;
        this.start_failure = null;
        const pending = this.pending;
        this.pending = null;
        pending?.cleanup();
        pending?.reject(error);
        reject(error);
        this.kill(child.pid);
      };
      const timer = setTimeout(() => fail(new Error(`Computer helper startup timed out. ${errors}`)), 20000);
      this.start_failure = fail;
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (data: string) => { errors = (errors + data).slice(-8000); });
      child.stdin?.on("error", (error) => fail(new Error(`Computer helper stdin failed: ${error.message}`)));
      child.on("error", fail);
      child.on("exit", (code) => fail(new Error(`Computer helper exited (${code}). ${errors}`)));
      child.stdout?.on("data", (data: string) => {
        if (this.child !== child) return;
        output += data;
        if (output.length > 134217728) { fail(new Error("Computer helper response is too large")); return; }
        let end = output.indexOf("\n");
        while (end >= 0) {
          const line = output.slice(0, end).trim();
          output = output.slice(end + 1);
          end = output.indexOf("\n");
          if (!line) continue;
          try {
            const value = JSON.parse(line);
            if (!started && value?.ready === true) {
              started = true;
              this.start_failure = null;
              clearTimeout(timer);
              resolve();
              continue;
            }
            const pending = this.pending;
            if (!pending || value?.id !== pending.id || typeof value.ok !== "boolean") throw new Error("Computer helper returned an unexpected response");
            this.pending = null;
            pending.cleanup();
            if (value.ok) pending.resolve(value.value);
            else pending.reject(new Error(typeof value.error === "string" ? value.error : "Computer action failed"));
          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        }
      });
    });
    this.ready = ready;
    void ready.catch(() => { if (this.ready === ready) this.ready = null; });
    return ready;
  }

  async request(request: HelperRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const starting = this.start();
    const abort_start = () => this.close();
    signal.addEventListener("abort", abort_start, { once: true });
    try { await starting; }
    finally { signal.removeEventListener("abort", abort_start); }
    signal.throwIfAborted();
    if (this.pending) throw new Error("A computer action is already running");
    const child = this.child;
    if (!child?.stdin) throw new Error("Computer helper is unavailable");
    const input = child.stdin;
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      let cancelling: ReturnType<typeof setTimeout> | null = null;
      const timeout = () => {
        if (this.pending?.id !== id) return;
        this.pending.cleanup();
        this.pending = null;
        this.child = null;
        this.ready = null;
        this.kill(child.pid);
        reject(new Error("Computer action timed out and was stopped; it was not retried"));
      };
      const cancel = () => {
        child.stdin?.write('{"op":"cancel"}\n');
        cancelling ??= setTimeout(timeout, 3000);
      };
      const timer = setTimeout(cancel, 20000);
      this.pending = { id, resolve, reject, cleanup: () => { clearTimeout(timer); if (cancelling) clearTimeout(cancelling); signal.removeEventListener("abort", cancel); } };
      signal.addEventListener("abort", cancel, { once: true });
      input.write(`${JSON.stringify({ ...request, id })}\n`);
    });
  }

  close() {
    const child = this.child;
    this.start_failure?.(new Error("Computer helper was closed during startup"));
    this.child = null;
    this.ready = null;
    const pending = this.pending;
    this.pending = null;
    pending?.cleanup();
    pending?.reject(new Error("Computer helper was closed"));
    child?.stdin?.end('{"op":"quit"}\n');
    if (child) {
      const timer = setTimeout(() => kill_tree_sync(child.pid), 4000);
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
    }
  }
}

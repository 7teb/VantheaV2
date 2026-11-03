import type { Hook } from "../../shared/hooks.ts";
import { result_cap_tokens } from "../context/estimate.ts";
import { run_shell } from "../shell/run.ts";
import { error_text } from "../storage/coerce.ts";

export type HookExit =
  | { kind: "exited"; exit_code: number | null; stdout: string; stderr: string; duration_ms: number }
  | { kind: "timed_out"; duration_ms: number }
  | { kind: "failed_start"; message: string; duration_ms: number }
  | { kind: "aborted" };

export const ascii_json = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export const run_hook = async (hook: Hook, input: Record<string, unknown>, cwd: string, signal: AbortSignal): Promise<HookExit> => {
  const started = Date.now();
  try {
    const outcome = await run_shell({
      command: hook.command,
      cwd,
      timeout_ms: hook.timeout_s * 1000,
      signal,
      on_output: () => undefined,
      shell: hook.shell,
      input: ascii_json(input),
    });
    if (outcome.kind === "detached") {
      throw new Error(`hook ${hook.id} was detached from its shell`);
    }
    if (outcome.timed_out) {
      return { kind: "timed_out", duration_ms: outcome.duration_ms };
    }
    if (outcome.start_error !== undefined) {
      return { kind: "failed_start", message: outcome.start_error, duration_ms: outcome.duration_ms };
    }
    return { kind: "exited", exit_code: outcome.exit_code, stdout: outcome.stdout.text(result_cap_tokens), stderr: outcome.stderr.text(result_cap_tokens), duration_ms: outcome.duration_ms };
  } catch (error) {
    if (signal.aborted) {
      return { kind: "aborted" };
    }
    console.error(`[hooks] hook ${hook.id} (${hook.event}, ${hook.shell}) could not run in ${cwd}:`, error);
    return { kind: "failed_start", message: error_text(error), duration_ms: Date.now() - started };
  }
};

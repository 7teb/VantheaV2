import fs from "node:fs/promises";
import path from "node:path";
import type { ApiEvent, PromptRequest, RunResult } from "../shared/api/contract.ts";
import { run_account } from "./cli-account.ts";
import { type AccountOptions, type CliOptions, compose_message, error_line, event_line, exit_code, file_mime, latest_session, type OutputFormat, parse_cli, reads_stdin, result_line, result_notes, usage } from "./cli-args.ts";
import { create_client, type Client } from "./client.ts";
import { error_text, VantheaxError } from "./http.ts";
import { create_vantheax } from "./launch.ts";

type Connection = { client: Client; close: () => Promise<void> };

type Phase = "prepare" | "run";

const failure_code = (error: unknown, fallback: string): string => (error instanceof VantheaxError ? error.code : fallback);

const report = (format: OutputFormat, code: string, message: string) => {
  if (format === "json") {
    process.stdout.write(error_line(code, message));
    return;
  }
  process.stderr.write(`vantheax: ${message}\n`);
};

const read_stdin = async (): Promise<string | null> => {
  if (process.stdin.isTTY) {
    return null;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const server_token_missing = (options: Pick<CliOptions, "server" | "format">): boolean => {
  if (!options.server || process.env.VANTHEAX_API_TOKEN) {
    return false;
  }
  report(options.format, "usage", "--server needs the API token in VANTHEAX_API_TOKEN");
  return true;
};

const connect = async (options: Pick<CliOptions, "server" | "exe" | "data_dir">, signal: AbortSignal): Promise<Connection> => {
  if (options.server) {
    const token = process.env.VANTHEAX_API_TOKEN ?? "";
    return { client: create_client({ base_url: options.server, token }), close: () => Promise.resolve() };
  }
  const instance = await create_vantheax({
    exe_path: options.exe ?? undefined,
    data_dir: options.data_dir ? path.resolve(options.data_dir) : undefined,
    signal,
  });
  return { client: instance.client, close: instance.close };
};

const pick_session = async (client: Client, options: CliOptions, signal: AbortSignal): Promise<string> => {
  if (options.session) {
    return options.session;
  }
  if (options.continue_latest) {
    const latest = latest_session(await client.sessions.list({ signal }));
    if (!latest) {
      throw new Error("--continue found no session in this data dir");
    }
    return latest.id;
  }
  const created = await client.sessions.create({ cwd: path.resolve(options.cwd ?? process.cwd()) }, { signal });
  return created.id;
};

const upload_files = (client: Client, files: readonly string[], signal: AbortSignal): Promise<string[]> =>
  Promise.all(
    files.map(async (file) => {
      const bytes = await fs.readFile(file);
      const name = path.basename(file);
      const attachment = await client.attachments.upload({ name, mime: file_mime(name), bytes }, { signal });
      return attachment.id;
    }),
  );

const event_printer = (format: OutputFormat) => {
  const tool_names = new Map<string, string>();
  return (event: ApiEvent) => {
    if (format === "json") {
      process.stdout.write(event_line(event));
      return;
    }
    if (event.type !== "turn.event") {
      return;
    }
    const data = event.data;
    if (data.type === "tool_call") {
      tool_names.set(`${data.message_id}:${data.call_id}`, data.name);
    }
    if (data.type === "tool_start") {
      process.stderr.write(`tool: ${tool_names.get(`${data.message_id}:${data.call_id}`) ?? data.call_id}\n`);
    }
  };
};

const print_result = (format: OutputFormat, result: RunResult) => {
  if (format === "json") {
    process.stdout.write(result_line(result));
    return;
  }
  if (result.text) {
    process.stdout.write(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
  }
  for (const note of result_notes(result)) {
    process.stderr.write(`vantheax: ${note}\n`);
  }
};

type Interrupts = { count: number; preparing: AbortController; running: AbortController; leaving: AbortController };

const stopped_result = async (client: Client, session_id: string, run_id: string | null, format: OutputFormat, interrupts: Interrupts, on_event: (event: ApiEvent) => void): Promise<number> => {
  if (!run_id) {
    report(format, "interrupted", "interrupted before the prompt was accepted");
    return 130;
  }
  if (interrupts.count > 1) {
    report(format, "interrupted", `interrupted again, not waiting for the stopped turn of run ${run_id}`);
    return 130;
  }
  try {
    print_result(format, await client.wait(session_id, run_id, { until: "turn", on_event, signal: interrupts.leaving.signal }));
  } catch (error) {
    report(format, "interrupted", `waiting for the stopped turn of run ${run_id} failed: ${error_text(error)}`);
  }
  return 130;
};

const account_main = async (options: AccountOptions): Promise<number> => {
  const format = options.format;
  if (server_token_missing(options)) {
    return 2;
  }
  const interrupted = new AbortController();
  process.on("SIGINT", () => interrupted.abort(new Error("interrupted")));
  let connection: Connection;
  try {
    connection = await connect(options, interrupted.signal);
  } catch (error) {
    report(format, interrupted.signal.aborted ? "interrupted" : "launch", error_text(error));
    return interrupted.signal.aborted ? 130 : 2;
  }
  try {
    const output = { out: (text: string) => process.stdout.write(text), err: (text: string) => process.stderr.write(text) };
    return await run_account(connection.client, options.command, format, { signal: interrupted.signal }, output);
  } catch (error) {
    if (interrupted.signal.aborted) {
      report(format, "interrupted", `interrupted, ${options.command.name} did not finish`);
      return 130;
    }
    report(format, failure_code(error, "internal"), error_text(error));
    return 1;
  } finally {
    await connection.close();
  }
};

const main = async (argv: string[]): Promise<number> => {
  const parsed = parse_cli(argv);
  if (parsed.kind === "help") {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (parsed.kind === "error") {
    report(parsed.format, "usage", parsed.message);
    if (parsed.format === "text") {
      process.stderr.write(`${usage}\n`);
    }
    return 2;
  }
  if (parsed.kind === "account") {
    return account_main(parsed.options);
  }
  const options = parsed.options;
  const format = options.format;
  if (server_token_missing(options)) {
    return 2;
  }
  const message = compose_message(options.message, reads_stdin(options.message) ? await read_stdin() : null);
  if (!message) {
    report(format, "usage", "no message: pass it as arguments or pipe it on stdin");
    return 2;
  }
  const interrupts: Interrupts = { count: 0, preparing: new AbortController(), running: new AbortController(), leaving: new AbortController() };
  const state: { phase: Phase; run_id: string | null; stop: () => void } = { phase: "prepare", run_id: null, stop: () => undefined };
  process.on("SIGINT", () => {
    interrupts.count += 1;
    if (state.phase === "prepare") {
      interrupts.preparing.abort(new Error("interrupted"));
      return;
    }
    if (interrupts.count > 1) {
      interrupts.leaving.abort(new Error("interrupted again"));
      interrupts.running.abort(new Error("interrupted again"));
      return;
    }
    if (state.run_id) {
      state.stop();
    }
  });
  let connection: Connection;
  try {
    connection = await connect(options, interrupts.preparing.signal);
  } catch (error) {
    report(format, interrupts.count ? "interrupted" : "launch", error_text(error));
    return interrupts.count ? 130 : 2;
  }
  try {
    const client = connection.client;
    let session_id: string;
    let attachment_ids: string[];
    try {
      session_id = await pick_session(client, options, interrupts.preparing.signal);
      attachment_ids = await upload_files(client, options.files, interrupts.preparing.signal);
    } catch (error) {
      report(format, interrupts.count ? "interrupted" : failure_code(error, "usage"), error_text(error));
      return interrupts.count ? 130 : 2;
    }
    if (interrupts.count) {
      return 130;
    }
    state.phase = "run";
    state.stop = () => {
      client.stop(session_id).then(
        () => interrupts.running.abort(new Error("interrupted")),
        (error: unknown) => {
          process.stderr.write(`vantheax: stopping the run in ${session_id} failed: ${error_text(error)}\n`);
          interrupts.running.abort(new Error("interrupted"));
        },
      );
    };
    const on_event = event_printer(format);
    const body: PromptRequest = {
      text: message,
      attachment_ids: attachment_ids.length ? attachment_ids : undefined,
      model: options.model ?? undefined,
      effort: options.effort ?? undefined,
      mode: options.mode ?? undefined,
      approvals: "reject",
    };
    let result: RunResult;
    try {
      result = await client.run(session_id, body, {
        on_event,
        on_started: (started) => {
          state.run_id = started.run_id;
          if (interrupts.count) {
            state.stop();
          }
        },
        signal: interrupts.running.signal,
      });
    } catch (error) {
      if (interrupts.count) {
        return await stopped_result(client, session_id, state.run_id, format, interrupts, on_event);
      }
      report(format, failure_code(error, "internal"), error_text(error));
      return state.run_id ? 1 : 2;
    }
    print_result(format, result);
    return interrupts.count ? 130 : exit_code(result);
  } finally {
    await connection.close();
  }
};

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`vantheax: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);

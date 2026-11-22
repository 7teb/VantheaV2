import type { ApiEvent, RunResult, SessionInfo } from "../shared/api/contract.ts";
import { permission_modes, type PermissionMode } from "../shared/chat.ts";
import { billing_modes, claude_billing_modes, type BillingMode, type ClaudeBillingMode } from "../shared/settings.ts";

export type OutputFormat = "text" | "json";

export type CliOptions = {
  message: string[];
  cwd: string | null;
  model: string | null;
  effort: string | null;
  mode: PermissionMode | null;
  session: string | null;
  continue_latest: boolean;
  files: string[];
  format: OutputFormat;
  exe: string | null;
  data_dir: string | null;
  server: string | null;
};

export type AccountCommand =
  | { name: "account" }
  | { name: "billing"; billing: BillingMode }
  | { name: "sign-in"; fresh: boolean; consent: boolean }
  | { name: "sign-out" }
  | { name: "claude-billing"; billing: ClaudeBillingMode }
  | { name: "claude" };

export type AccountOptions = { command: AccountCommand; format: OutputFormat; exe: string | null; data_dir: string | null; server: string | null };

type CliParse =
  | { kind: "ok"; options: CliOptions }
  | { kind: "account"; options: AccountOptions }
  | { kind: "help" }
  | { kind: "error"; message: string; format: OutputFormat };

export const usage = [
  "usage: vantheax run [message..] [-] [--cwd dir] [--model id] [--effort e] [--mode ask|auto|full]",
  "                    [--session id | --continue] [--file path]... [--format text|json]",
  "                    [--exe path] [--data-dir path] [--server url]",
  "       vantheax account [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax billing api|chatgpt [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax sign-in [--fresh] [--consent] [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax sign-out [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax claude-billing api|claude [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax claude [--format text|json] [--exe path] [--data-dir path] [--server url]",
  "       vantheax --help",
].join("\n");

type ValueFlag = "cwd" | "model" | "effort" | "mode" | "session" | "file" | "format" | "exe" | "data-dir" | "server";

const value_flags = new Set<string>(["cwd", "model", "effort", "mode", "session", "file", "format", "exe", "data-dir", "server"] satisfies ValueFlag[]);

const connection_flags = new Set<string>(["format", "exe", "data-dir", "server"]);

const account_commands = new Set<string>(["account", "billing", "sign-in", "sign-out", "claude-billing", "claude"]);

const sign_in_switches: readonly string[] = ["fresh", "consent"];

const private_instance_conflict = "--exe and --data-dir start a private instance and cannot be combined with --server";

const output_formats: readonly OutputFormat[] = ["text", "json"];

const is_mode = (value: string): value is PermissionMode => (permission_modes as readonly string[]).includes(value);

const is_format = (value: string): value is OutputFormat => (output_formats as readonly string[]).includes(value);

const is_billing = (value: string): value is BillingMode => (billing_modes as readonly string[]).includes(value);

const is_claude_billing = (value: string): value is ClaudeBillingMode => (claude_billing_modes as readonly string[]).includes(value);

type FlagValue = { value: string | undefined; consumed: boolean };

const flag_value = (rest: readonly string[], index: number, token: string, equals: number): FlagValue => {
  const inline = equals < 0 ? undefined : token.slice(equals + 1);
  const following = rest[index + 1];
  return { value: inline ?? (following !== undefined && !following.startsWith("--") ? following : undefined), consumed: inline === undefined };
};

const help_flags = new Set(["--help", "-h"]);

const requested_format = (argv: readonly string[]): OutputFormat => {
  const index = argv.findLastIndex((token) => token === "--format" || token.startsWith("--format="));
  const token = argv[index];
  const value = token?.startsWith("--format=") ? token.slice("--format=".length) : argv[index + 1];
  return value === "json" ? "json" : "text";
};

export const parse_cli = (argv: readonly string[]): CliParse => {
  const format = requested_format(argv);
  const error = (message: string): CliParse => ({ kind: "error", message, format });
  const [command, ...rest] = argv;
  if (argv.some((token) => help_flags.has(token))) {
    return { kind: "help" };
  }
  if (command !== undefined && account_commands.has(command)) {
    return parse_account(command, rest, error);
  }
  if (command !== "run") {
    return error(command ? `unknown command ${command}` : "missing command");
  }
  const options: CliOptions = {
    message: [],
    cwd: null,
    model: null,
    effort: null,
    mode: null,
    session: null,
    continue_latest: false,
    files: [],
    format: "text",
    exe: null,
    data_dir: null,
    server: null,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      options.message.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = token.slice(2, equals < 0 ? undefined : equals);
    if (name === "continue") {
      if (equals >= 0) {
        return error("--continue takes no value");
      }
      options.continue_latest = true;
      continue;
    }
    if (!value_flags.has(name)) {
      return error(`unknown flag ${token}`);
    }
    const { value, consumed } = flag_value(rest, index, token, equals);
    if (value === undefined || value === "") {
      return error(`--${name} needs a value`);
    }
    if (consumed) {
      index += 1;
    }
    switch (name as ValueFlag) {
      case "cwd":
        options.cwd = value;
        break;
      case "model":
        options.model = value;
        break;
      case "effort":
        options.effort = value;
        break;
      case "mode":
        if (!is_mode(value)) {
          return error(`--mode must be one of ${permission_modes.join(", ")}, got ${value}`);
        }
        options.mode = value;
        break;
      case "session":
        options.session = value;
        break;
      case "file":
        options.files.push(value);
        break;
      case "format":
        if (!is_format(value)) {
          return error(`--format must be text or json, got ${value}`);
        }
        options.format = value;
        break;
      case "exe":
        options.exe = value;
        break;
      case "data-dir":
        options.data_dir = value;
        break;
      case "server":
        options.server = value;
        break;
    }
  }
  if (options.session !== null && options.continue_latest) {
    return error("--session and --continue cannot be combined");
  }
  if (options.cwd !== null && (options.session !== null || options.continue_latest)) {
    return error("--cwd only applies to a new session and cannot be combined with --session or --continue");
  }
  if (options.server !== null && (options.exe !== null || options.data_dir !== null)) {
    return error(private_instance_conflict);
  }
  return { kind: "ok", options };
};

const account_command = (command: string, positional: readonly string[], switches: ReadonlySet<string>): AccountCommand | string => {
  if (command === "billing") {
    const [billing] = positional;
    return positional.length === 1 && is_billing(billing) ? { name: "billing", billing } : `billing needs exactly one of ${billing_modes.join(", ")}`;
  }
  if (command === "claude-billing") {
    const [billing] = positional;
    return positional.length === 1 && is_claude_billing(billing) ? { name: "claude-billing", billing } : `claude-billing needs exactly one of ${claude_billing_modes.join(", ")}`;
  }
  if (positional.length) {
    return `${command} takes no arguments, got ${positional.join(" ")}`;
  }
  if (command === "sign-in") {
    return { name: "sign-in", fresh: switches.has("fresh"), consent: switches.has("consent") };
  }
  if (command === "claude") {
    return { name: "claude" };
  }
  return command === "sign-out" ? { name: "sign-out" } : { name: "account" };
};

const parse_account = (command: string, rest: readonly string[], error: (message: string) => CliParse): CliParse => {
  const options: AccountOptions = { command: { name: "account" }, format: "text", exe: null, data_dir: null, server: null };
  const positional: string[] = [];
  const switches = new Set<string>();
  const allowed_switches = command === "sign-in" ? sign_in_switches : [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = token.slice(2, equals < 0 ? undefined : equals);
    if (allowed_switches.includes(name)) {
      if (equals >= 0) {
        return error(`--${name} takes no value`);
      }
      switches.add(name);
      continue;
    }
    if (!connection_flags.has(name)) {
      return error(`unknown flag ${token}`);
    }
    const { value, consumed } = flag_value(rest, index, token, equals);
    if (value === undefined || value === "") {
      return error(`--${name} needs a value`);
    }
    if (consumed) {
      index += 1;
    }
    if (name === "format") {
      if (!is_format(value)) {
        return error(`--format must be text or json, got ${value}`);
      }
      options.format = value;
    } else if (name === "exe") {
      options.exe = value;
    } else if (name === "data-dir") {
      options.data_dir = value;
    } else {
      options.server = value;
    }
  }
  if (options.server !== null && (options.exe !== null || options.data_dir !== null)) {
    return error(private_instance_conflict);
  }
  const parsed = account_command(command, positional, switches);
  return typeof parsed === "string" ? error(parsed) : { kind: "account", options: { ...options, command: parsed } };
};

export const reads_stdin = (args: readonly string[]): boolean => args.length === 0 || args.includes("-");

export const compose_message = (args: readonly string[], stdin: string | null): string => {
  const typed = args.filter((arg) => arg !== "-").join(" ").trim();
  const piped = stdin?.trimEnd() ?? "";
  if (!piped.trim()) {
    return typed;
  }
  return typed ? `${typed}\n\n${piped}` : piped;
};

export const latest_session = (sessions: readonly SessionInfo[]): SessionInfo | null =>
  sessions.reduce<SessionInfo | null>((latest, session) => (!latest || Date.parse(session.updated_at) > Date.parse(latest.updated_at) ? session : latest), null);

export const exit_code = (result: RunResult): number =>
  result.status === "done" &&
  result.needs_input.questions.length === 0 &&
  result.needs_input.approvals.length === 0 &&
  result.needs_input.plan_message_id === null
    ? 0
    : 1;

export const result_notes = (result: RunResult): string[] => [
  ...(result.status === "done" ? [] : [`status: ${result.status}${result.error ? ` (${result.error.kind}: ${result.error.message})` : ""}`]),
  ...result.needs_input.questions.map((question) => `question: ${question.title}`),
  ...result.needs_input.approvals.map((approval) => `approval pending: ${approval.approval_id}`),
  ...(result.needs_input.plan_message_id ? [`plan waits for acceptance: ${result.needs_input.plan_message_id}`] : []),
];

export const event_line = (event: ApiEvent): string => `${JSON.stringify(event)}\n`;

export const result_line = (result: RunResult): string => `${JSON.stringify({ type: "result", result })}\n`;

export const error_line = (code: string, message: string): string => `${JSON.stringify({ type: "error", error: { code, message } })}\n`;

const image_mimes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export const file_mime = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return (dot < 0 ? undefined : image_mimes[name.slice(dot + 1).toLowerCase()]) ?? "application/octet-stream";
};

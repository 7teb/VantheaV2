import { console_args_text, remote_object_text } from "../browser/console-text.ts";
import { as_array, as_record } from "../storage/coerce.ts";

const noise = /fonts\.g|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION|Failed to load resource.*(fonts|gstatic)/i;

const text_of = (value: unknown): string => (typeof value === "string" ? value : "");

const file_name = (url: string): string => url.split("/").pop() ?? "";

const exception_error = (params: Record<string, unknown>): string => {
  const details = as_record(params.exceptionDetails);
  const url = text_of(details.url);
  const line = typeof details.lineNumber === "number" ? details.lineNumber : Number.NaN;
  const where = url ? `${file_name(url)}:${line + 1}` : "";
  const description = remote_object_text(details.exception) || text_of(details.text);
  return `exception ${where} ${description.split("\n")[0]}`.slice(0, 240);
};

const console_error = (params: Record<string, unknown>): string | null => {
  if (params.type !== "error") {
    return null;
  }
  const text = console_args_text(as_array(params.args));
  return noise.test(text) ? null : `console.error ${text.slice(0, 220)}`;
};

const log_error = (params: Record<string, unknown>): string | null => {
  const entry = as_record(params.entry);
  if (entry.level !== "error") {
    return null;
  }
  const text = text_of(entry.text);
  const url = text_of(entry.url);
  if (noise.test(text + url) || text.includes("ERR_BLOCKED_BY_CLIENT")) {
    return null;
  }
  return `log ${text} ${file_name(url)}`.slice(0, 220);
};

export const page_error = (method: string, params: unknown): string | null => {
  const record = as_record(params);
  if (method === "Runtime.exceptionThrown") {
    return exception_error(record);
  }
  if (method === "Runtime.consoleAPICalled") {
    return console_error(record);
  }
  if (method === "Log.entryAdded") {
    return log_error(record);
  }
  return null;
};

export const count_repeats = (errors: string[]): string[] => {
  const seen = new Map<string, number>();
  for (const error of errors) {
    seen.set(error, (seen.get(error) ?? 0) + 1);
  }
  return [...seen].map(([error, count]) => (count > 1 ? `${error}  (x${count})` : error));
};

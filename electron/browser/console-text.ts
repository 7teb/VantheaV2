import { as_array, as_record, as_string } from "../storage/coerce.ts";

export type ConsoleLevel = "error" | "warn" | "info" | "log" | "debug";

export const console_levels: readonly ConsoleLevel[] = ["error", "warn", "info", "log", "debug"];

export type ConsoleMessage = { level: ConsoleLevel; origin: string; text: string; location: string };

const plain_subtypes = new Set(["node", "error", "regexp", "date", "null", "promise", "proxy", "generator", "iterator"]);

const preview_value = (property: Record<string, unknown>): string => {
  if (property.type === "string") {
    return JSON.stringify(as_string(property.value));
  }
  if (property.type === "accessor") {
    return "(...)";
  }
  if (property.valuePreview !== undefined) {
    return preview_text(as_record(property.valuePreview));
  }
  return as_string(property.value) || as_string(property.type);
};

const preview_text = (preview: Record<string, unknown>): string => {
  const description = as_string(preview.description);
  const subtype = as_string(preview.subtype);
  const properties = as_array(preview.properties).map(as_record);
  const more = preview.overflow === true ? ", …" : "";
  if (subtype === "array" || subtype === "typedarray") {
    const items = properties.map((property) => (/^\d+$/.test(as_string(property.name)) ? preview_value(property) : `${as_string(property.name)}: ${preview_value(property)}`));
    return `${description} [${items.join(", ")}${more}]`.trim();
  }
  if (subtype === "map" || subtype === "set" || subtype === "weakmap" || subtype === "weakset") {
    const entries = as_array(preview.entries).map((raw) => {
      const entry = as_record(raw);
      const value = preview_text(as_record(entry.value));
      return entry.key === undefined ? value : `${preview_text(as_record(entry.key))} => ${value}`;
    });
    return `${description} {${entries.join(", ")}${more}}`.trim();
  }
  if (preview.type !== "object" || plain_subtypes.has(subtype)) {
    return description;
  }
  const fields = properties.map((property) => `${as_string(property.name)}: ${preview_value(property)}`);
  const prefix = description && description !== "Object" ? `${description} ` : "";
  return `${prefix}{${fields.join(", ")}${more}}`;
};

export const remote_object_text = (value: unknown): string => {
  const object = as_record(value);
  if (typeof object.unserializableValue === "string") {
    return object.unserializableValue;
  }
  if (object.type === "undefined") {
    return "undefined";
  }
  if (object.subtype === "null") {
    return "null";
  }
  if (object.type === "string") {
    return as_string(object.value);
  }
  if (object.preview !== undefined && !plain_subtypes.has(as_string(object.subtype))) {
    return preview_text(as_record(object.preview));
  }
  if (typeof object.description === "string") {
    return object.description;
  }
  if (!("value" in object)) {
    return "";
  }
  return typeof object.value === "string" ? object.value : (JSON.stringify(object.value) ?? "");
};

export const console_args_text = (args: unknown[]): string => {
  const [first, ...rest] = args;
  const head = as_record(first);
  const template = as_string(head.value);
  if (head.type !== "string" || !template.includes("%")) {
    return args.map(remote_object_text).join(" ");
  }
  let used = 0;
  const formatted = template.replace(/%[sdifoOc%]/g, (marker) => {
    if (marker === "%%") {
      return "%";
    }
    if (used >= rest.length) {
      return marker;
    }
    const arg = rest[used];
    used += 1;
    return marker === "%c" ? "" : remote_object_text(arg);
  });
  return [formatted, ...rest.slice(used).map(remote_object_text)].join(" ");
};

export const exception_text = (value: unknown): string => {
  const details = as_record(value);
  const text = as_string(details.text);
  const thrown = details.exception === undefined ? "" : remote_object_text(details.exception);
  return thrown ? `${text} ${thrown}`.trim() : text;
};

const place = (url: string, line: unknown, column: unknown): string => {
  if (!url) {
    return "";
  }
  const at_line = typeof line === "number" ? `:${line + 1}` : "";
  const at_column = typeof line === "number" && typeof column === "number" ? `:${column + 1}` : "";
  return `${url}${at_line}${at_column}`;
};

const top_frame = (stack: unknown): string => {
  const frame = as_record(as_array(as_record(stack).callFrames)[0]);
  return place(as_string(frame.url), frame.lineNumber, frame.columnNumber);
};

const call_levels: Record<string, ConsoleLevel> = { error: "error", assert: "error", warning: "warn", info: "info", debug: "debug" };

const log_levels: Record<string, ConsoleLevel> = { error: "error", warning: "warn", info: "info", verbose: "debug" };

const console_call = (params: Record<string, unknown>): ConsoleMessage | null => {
  const type = as_string(params.type);
  if (type === "endGroup") {
    return null;
  }
  const text = type === "clear" ? "console.clear() was called" : console_args_text(as_array(params.args));
  return { level: call_levels[type] ?? "log", origin: "", text, location: top_frame(params.stackTrace) };
};

const thrown_exception = (params: Record<string, unknown>): ConsoleMessage => {
  const details = as_record(params.exceptionDetails);
  const location = place(as_string(details.url), details.lineNumber, details.columnNumber) || top_frame(details.stackTrace);
  return { level: "error", origin: "", text: exception_text(details), location };
};

const log_entry = (params: Record<string, unknown>): ConsoleMessage => {
  const entry = as_record(params.entry);
  return {
    level: log_levels[as_string(entry.level)] ?? "info",
    origin: as_string(entry.source),
    text: as_string(entry.text),
    location: place(as_string(entry.url), entry.lineNumber, undefined) || top_frame(entry.stackTrace),
  };
};

export const console_message = (method: string, params: unknown): ConsoleMessage | null => {
  const record = as_record(params);
  if (method === "Runtime.consoleAPICalled") {
    return console_call(record);
  }
  if (method === "Runtime.exceptionThrown") {
    return thrown_exception(record);
  }
  if (method === "Log.entryAdded") {
    return log_entry(record);
  }
  return null;
};

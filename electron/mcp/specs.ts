import type { JsonSchema } from "../tools/types.ts";

const max_spec_name = 64;
export const max_description = 500;
const max_schema_chars = 4000;
export const max_result_chars = 100000;

export const sanitize_server_name = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const safe_part = (value: string, fallback: string) =>
  value
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;

export const build_spec_name = (server: string, tool: string, used: Set<string>) => {
  const prefix = `mcp__${safe_part(server, "server")}__`;
  const base = `${prefix}${safe_part(tool, "tool")}`.slice(0, max_spec_name);
  let name = base;
  for (let index = 2; used.has(name); index += 1) {
    const suffix = `_${index}`;
    name = `${base.slice(0, max_spec_name - suffix.length)}${suffix}`;
  }
  used.add(name);
  return name;
};

const cap_description = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > max_description ? `${trimmed.slice(0, max_description)} ...(truncated)` : trimmed;
};

const open_schema = (): JsonSchema => ({ type: "object", properties: {}, additionalProperties: true });

export const build_parameters = (schema: unknown): { parameters: JsonSchema; degraded: boolean } => {
  const source = schema as Record<string, unknown> | null;
  if (!source || typeof source !== "object" || source.type !== "object" || !source.properties || typeof source.properties !== "object") {
    return { parameters: open_schema(), degraded: false };
  }
  const { required, ...rest } = source;
  const parameters: JsonSchema = { ...rest, type: "object", properties: source.properties as Record<string, unknown> };
  if (Array.isArray(required) && required.every((entry) => typeof entry === "string")) {
    parameters.required = required;
  }
  const serialized = JSON.stringify(parameters);
  if (serialized.length > max_schema_chars) {
    return { parameters: open_schema(), degraded: true };
  }
  return { parameters, degraded: false };
};

export const build_description = (server: string, tool: string, description: string, degraded: boolean) => {
  const base = cap_description(description || `${tool} (MCP server ${server})`);
  return degraded ? cap_description(`${base} [schema omitted: too large, pass arguments as the server expects]`) : base;
};

type ContentPart = { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown; resource?: { uri?: unknown }; uri?: unknown };

const part_text = (part: ContentPart) => {
  if (part.type === "text") {
    return String(part.text ?? "");
  }
  if (part.type === "image" || part.type === "audio") {
    return `[${part.type}: ${String(part.mimeType ?? part.type)}, ${String(part.data ?? "").length} base64 chars omitted]`;
  }
  if (part.type === "resource") {
    return `[resource: ${String(part.resource?.uri ?? "embedded")}, not inlined]`;
  }
  if (part.type === "resource_link") {
    return `[resource link: ${String(part.uri ?? "")}]`;
  }
  return `[${String(part.type ?? "unknown")} content omitted]`;
};

export type McpResultText = { text: string; is_error: boolean; truncated: boolean };

export type CallResult = { content?: unknown; structuredContent?: unknown; toolResult?: unknown; isError?: unknown };

export const format_result = (result: CallResult): McpResultText => {
  const parts = Array.isArray(result.content) ? (result.content as ContentPart[]) : [];
  let text = parts
    .filter((part) => part && typeof part === "object")
    .map(part_text)
    .join("\n");
  const structured = result.structuredContent ?? result.toolResult;
  if (!text && structured !== undefined) {
    text = JSON.stringify(structured);
  }
  const truncated = text.length > max_result_chars;
  if (truncated) {
    text = `${text.slice(0, max_result_chars)}\n[MCP result truncated: showing ${max_result_chars} of ${text.length} chars, request a smaller range or page]`;
  }
  const is_error = result.isError === true;
  const body = text || "(empty result)";
  return { text: is_error ? `[MCP tool error] ${body}` : body, is_error, truncated };
};

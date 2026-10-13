import type { JsonSchema } from "../tools/types.ts";

const max_spec_name = 64;

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

const open_schema = (): JsonSchema => ({ type: "object", properties: {}, additionalProperties: true });

export const build_parameters = (schema: unknown): JsonSchema => {
  const source = schema as Record<string, unknown> | null;
  if (!source || typeof source !== "object" || source.type !== "object" || !source.properties || typeof source.properties !== "object") {
    return open_schema();
  }
  const { required, ...rest } = source;
  const parameters: JsonSchema = { ...rest, type: "object", properties: source.properties as Record<string, unknown> };
  if (Array.isArray(required) && required.every((entry) => typeof entry === "string")) {
    parameters.required = required;
  }
  return parameters;
};

export const build_description = (server: string, tool: string, description: string) => description.trim() || `${tool} (MCP server ${server})`;

type EmbeddedResource = { uri?: unknown; mimeType?: unknown; text?: unknown; blob?: unknown };

type ContentPart = { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown; resource?: EmbeddedResource; uri?: unknown };

export type McpImage = { mime: string; data: string };

export const audio_note = "not passed on, because the model has no audio input";

const image_marker = (images: McpImage[], image: McpImage, source: string) => {
  images.push(image);
  return `[image ${images.length}: ${image.mime}${source}]`;
};

const resource_text = (resource: EmbeddedResource, images: McpImage[]) => {
  const uri = String(resource.uri ?? "embedded");
  const mime = typeof resource.mimeType === "string" ? resource.mimeType : "";
  if (typeof resource.text === "string") {
    return `[resource: ${uri}${mime ? `, ${mime}` : ""}]\n${resource.text}`;
  }
  if (typeof resource.blob !== "string") {
    return `[resource: ${uri}, the server sent no content for it]`;
  }
  if (mime.startsWith("image/")) {
    return image_marker(images, { mime, data: resource.blob }, `, resource ${uri}`);
  }
  return `[resource: ${uri}, ${mime || "binary"}, ${resource.blob.length} base64 chars of binary content not passed on, because the model takes only text and images]`;
};

const part_text = (part: ContentPart, images: McpImage[]) => {
  if (part.type === "text") {
    return String(part.text ?? "");
  }
  if (part.type === "image") {
    return image_marker(images, { mime: String(part.mimeType ?? "image"), data: String(part.data ?? "") }, "");
  }
  if (part.type === "audio") {
    return `[audio: ${String(part.mimeType ?? "audio")}, ${audio_note}]`;
  }
  if (part.type === "resource") {
    return resource_text(part.resource ?? {}, images);
  }
  if (part.type === "resource_link") {
    return `[resource link: ${String(part.uri ?? "")}]`;
  }
  return `[${String(part.type ?? "unknown")} content omitted]`;
};

export type McpResultText = { text: string; is_error: boolean; images: McpImage[] };

export type CallResult = { content?: unknown; structuredContent?: unknown; toolResult?: unknown; isError?: unknown };

export const format_result = (result: CallResult): McpResultText => {
  const parts = Array.isArray(result.content) ? (result.content as ContentPart[]) : [];
  const images: McpImage[] = [];
  let text = parts
    .filter((part) => part && typeof part === "object")
    .map((part) => part_text(part, images))
    .join("\n");
  const structured = result.structuredContent ?? result.toolResult;
  if (!text && structured !== undefined) {
    text = JSON.stringify(structured);
  }
  const is_error = result.isError === true;
  const body = text || "(empty result)";
  return { text: is_error ? `[MCP tool error] ${body}` : body, is_error, images };
};

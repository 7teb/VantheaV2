import type { McpTier } from "../approval.ts";
import type { McpServerConfig } from "../settings.ts";
import { emit, invoke } from "./channel.ts";

export type McpToolStatus = { name: string; description: string; tier: McpTier; enabled: boolean; overridden: boolean };

export type McpServerStatus = {
  name: string;
  config: McpServerConfig;
  state: "stopped" | "starting" | "ready" | "error";
  error: string;
  trusted: boolean;
  tools: McpToolStatus[];
  stderr_tail: string;
};

export type SkillEntry = { slug: string; name: string; description: string; enabled: boolean; files: string[]; source: string; error: string };

export type MemoryRecord = { id: string; text: string; project_path: string; created_at: string };

export type MemoryReviewItem = { id: string; text: string; reason: string };

export const extensions_channels = {
  "mcp:status": invoke<[], McpServerStatus[]>(),
  "mcp:upsert": invoke<[name: string, config: McpServerConfig], McpServerStatus[]>(),
  "mcp:remove": invoke<[name: string], McpServerStatus[]>(),
  "mcp:reconnect": invoke<[name: string], McpServerStatus[]>(),
  "mcp:set_tool": invoke<[server: string, tool: string, patch: { risk?: McpTier | null; enabled?: boolean }], McpServerStatus[]>(),
  "mcp:set_trust": invoke<[server: string, trusted: boolean], McpServerStatus[]>(),
  "mcp:detect_folder": invoke<[], { name: string; config: McpServerConfig } | null>(),
  "mcp:changed": emit<McpServerStatus[]>(),
  "skills:list": invoke<[], SkillEntry[]>(),
  "skills:body": invoke<[slug: string], string>(),
  "skills:set_enabled": invoke<[slug: string, enabled: boolean], SkillEntry[]>(),
  "skills:remove": invoke<[slug: string], SkillEntry[]>(),
  "skills:open_folder": invoke<[], void>(),
  "memory:list": invoke<[], MemoryRecord[]>(),
  "memory:review": invoke<[], MemoryReviewItem[]>(),
  "memory:resolve": invoke<[id: string, action: "keep" | "discard"], MemoryReviewItem[]>(),
  "memory:remove": invoke<[id: string], MemoryRecord[]>(),
  "memory:reset": invoke<[], void>(),
} as const;

import type { McpTier } from "./approval.ts";
import type { PermissionMode } from "./chat.ts";

export type Language = "en" | "de";

export type Personality = "pragmatic" | "friendly" | "cynical";

export type ProjectEntry = { path: string; name: string; pinned: boolean; folder_id: string };

export type McpServerConfig = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  enabled: boolean;
};

export type McpToolOverride = { risk: McpTier | null; enabled: boolean };

export const mcp_tool_key = (server: string, tool: string) => `${server}/${tool}`;

export type Settings = {
  language: Language;
  model: string;
  effort: string;
  mode: PermissionMode;
  projects: ProjectEntry[];
  personality: Personality;
  custom_instructions: string;
  memory: { enabled: boolean; exclude_tool_chats: boolean };
  web_search: { enabled: boolean; max_results: number; depth: "basic" | "advanced"; topic: "general" | "news" };
  image_gen: { enabled: boolean; model: string; quality: "auto" | "low" | "medium" | "high" };
  mcp_servers: Record<string, McpServerConfig>;
  mcp_tools: Record<string, McpToolOverride>;
  skills: { disabled: string[] };
};

export type SecretName = "openrouter" | "tavily";

export type SettingsView = Settings & { secrets: Record<SecretName, boolean> };

export type SettingsPatch = Partial<{
  [K in keyof Settings]: Settings[K] extends unknown[] ? Settings[K] : Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
}>;

export type Balance = { limit: number | null; usage: number; remaining: number | null };

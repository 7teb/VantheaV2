import type { GrantScope, McpTier } from "../../shared/approval.ts";

export type GrantTarget = { server: string; tool: string; tier: McpTier; scope: string | null };

const chats = new Map<string, Map<string, Set<string>>>();
const trusted_servers = new Set<string>();

export const is_trusted = (server: string) => trusted_servers.has(server);

export const set_server_trust = (server: string, trusted: boolean) => {
  if (trusted) {
    trusted_servers.add(server);
  } else {
    trusted_servers.delete(server);
  }
};

export const clear_mcp_chat = (chat_id: string) => {
  chats.delete(chat_id);
};

export const clear_server_grants = (server: string) => {
  trusted_servers.delete(server);
  for (const [chat_id, servers] of chats) {
    servers.delete(server);
    if (!servers.size) {
      chats.delete(chat_id);
    }
  }
};

const covering_keys = (call: GrantTarget): string[] => {
  if (call.tier === "readonly") {
    return ["readonly", "state", "dangerous"];
  }
  if (call.tier === "state_change") {
    return [`tool:${call.tool}`, "state", "dangerous"];
  }
  if (call.tier === "dangerous") {
    return [...(call.scope ? [`scope:${call.tool}|${call.scope}`] : []), "dangerous"];
  }
  return [];
};

const granted_key = (call: GrantTarget, grant: GrantScope): string | null => {
  if (grant !== "chat" && grant !== "session") {
    return null;
  }
  if (call.tier === "readonly") {
    return "readonly";
  }
  if (call.tier === "state_change") {
    return grant === "chat" ? `tool:${call.tool}` : "state";
  }
  if (call.tier === "dangerous") {
    if (grant === "session") {
      return "dangerous";
    }
    return call.scope ? `scope:${call.tool}|${call.scope}` : null;
  }
  return null;
};

export const has_grant = (chat_id: string, call: GrantTarget) => {
  const keys = chats.get(chat_id)?.get(call.server);
  return Boolean(keys && covering_keys(call).some((key) => keys.has(key)));
};

export const record_grant = (chat_id: string, call: GrantTarget, grant: GrantScope) => {
  const key = granted_key(call, grant);
  if (!key) {
    return;
  }
  const servers = chats.get(chat_id) ?? new Map<string, Set<string>>();
  const keys = servers.get(call.server) ?? new Set<string>();
  keys.add(key);
  servers.set(call.server, keys);
  chats.set(chat_id, servers);
};

export const server_name = "vantheax";

const prefix = `mcp__${server_name}__`;

export const bare_name = (name: string): string => (name.startsWith(prefix) ? name.slice(prefix.length) : name);

export const silent_tools: ReadonlySet<string> = new Set(["EndConversation"]);

import path from "node:path";
import { permission_hash, permission_intent } from "../../permissions/context.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import { call_tool, default_call_timeout_ms, ready_servers, type McpToolInfo } from "../../mcp/client.ts";
import { target_scope } from "../../mcp/risk.ts";
import { effective_tier, is_trusted, tool_enabled } from "../../mcp/servers.ts";
import { build_description, build_parameters } from "../../mcp/specs.ts";
import { define_tool, type Tool, type ToolContext, type ToolResult } from "../types.ts";
import { decide, record_grant, type McpCall } from "./decide.ts";
import { mcp_overseer } from "./overseer.ts";

const view_text_limit = 8000;
const preview_limit = 2000;

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

const mcp_view = (server: string, tool: string, text: string, is_error: boolean): ToolView => ({ kind: "mcp", server, tool, text: text.slice(0, view_text_limit), is_error });

export const args_preview = (args: Record<string, unknown>) => {
  const text = JSON.stringify(args, null, 2);
  return text.length > preview_limit ? `${text.slice(0, preview_limit)}\n...` : text;
};

const invoke = async (ctx: ToolContext, call: McpCall): Promise<ToolResult> => {
  const label = `${call.server} ${call.tool}`;
  ctx.progress({ label, lines: null, output_tail: null });
  try {
    const result = await call_tool(call.server, call.tool, call.args, {
      signal: ctx.signal,
      timeout_ms: default_call_timeout_ms,
      on_progress: (message) => ctx.progress({ label, lines: null, output_tail: message }),
    });
    return { status: result.is_error ? "failed" : "done", text: result.text, view: mcp_view(call.server, call.tool, result.text, result.is_error) };
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    const text = `[MCP tool error] ${error_text(error)}`;
    console.warn(`[mcp] ${label} failed: ${error_text(error)}`);
    return { status: "failed", text, view: mcp_view(call.server, call.tool, text, true) };
  }
};

const run_mcp = async (ctx: ToolContext, server: string, info: McpToolInfo, args: Record<string, unknown>): Promise<ToolResult> => {
  const tier = effective_tier(server, info);
  const call: McpCall = { server, tool: info.name, tier, args, scope: tier === "dangerous" ? target_scope(args) : null, trusted: is_trusted(server) };
  const authorization = permission_hash(permission_intent(ctx) + (ctx.delegated_task ?? ""));
  const server_cwd = path.resolve(ctx.settings.mcp_servers[server]?.cwd || process.cwd());
  ctx.execution_cwd = typeof args.cwd === "string" ? path.resolve(server_cwd, args.cwd) : server_cwd;
  const verdict = await decide(call, ctx, mcp_overseer);
  if (verdict.kind === "block" || verdict.kind === "denied") {
    return { status: verdict.kind === "denied" ? "denied" : "failed", text: verdict.reason, view: mcp_view(server, info.name, verdict.reason, true) };
  }
  if (verdict.kind === "ask") {
    const decision = await ctx.approve({ kind: "mcp", server, tool: info.name, tier, args_preview: args_preview(args), scope: call.scope });
    if (!decision.approved) {
      const feedback = decision.feedback ? ` User feedback: ${decision.feedback}` : "";
      const text = `The user denied ${server}/${info.name} (${verdict.reason}).${feedback}`;
      return { status: "denied", text, view: mcp_view(server, info.name, text, true) };
    }
    if (permission_hash(permission_intent(ctx)) !== authorization || (ctx.execution_check && !(await ctx.execution_check()))) {
      return { status: "denied", text: "The human instructions or inspected script changed while this MCP approval was pending. The tool was not executed.", view: null };
    }
    record_grant(ctx.chat_id, call, decision.grant, ctx);
  }
  ctx.signal.throwIfAborted();
  if (permission_hash(permission_intent(ctx)) !== authorization || (ctx.execution_check && !(await ctx.execution_check()))) {
    return { status: "denied", text: "The reviewed context changed before the MCP tool could run.", view: null };
  }
  return invoke(ctx, call);
};

const mcp_tool = (server: string, info: McpToolInfo): Tool => {
  const { parameters, degraded } = build_parameters(info.input_schema);
  return define_tool<Record<string, unknown>>({
    spec: { name: info.spec_name, description: build_description(server, info.name, info.description, degraded), parameters },
    profiles: ["main"],
    parse: (raw) => raw,
    run: (ctx, args) => run_mcp(ctx, server, info, args),
  });
};

export const mcp_tools = (): Tool[] =>
  ready_servers().flatMap((server) => server.tools.filter((tool) => tool_enabled(server.name, tool.name)).map((tool) => mcp_tool(server.name, tool)));

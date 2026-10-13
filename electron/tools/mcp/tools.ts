import path from "node:path";
import type { ToolView } from "../../../shared/tool-view.ts";
import { call_tool, default_call_timeout_ms, ready_servers, type McpToolInfo } from "../../mcp/client.ts";
import { target_scope } from "../../mcp/risk.ts";
import { effective_tier, is_trusted, tool_enabled } from "../../mcp/servers.ts";
import { build_description, build_parameters, type McpResultText } from "../../mcp/specs.ts";
import { changed_pins, type PinChange } from "../../permissions/source-read.ts";
import { approved_note, scripts_changed_text, user_denied_text } from "../../permissions/verdict-text.ts";
import { define_tool, type Tool, type ToolContext, type ToolResult } from "../types.ts";
import { decide, record_grant, type McpCall } from "./decide.ts";
import { mcp_images } from "./images.ts";
import { mcp_review } from "./overseer.ts";

const view_text_limit = 8000;

const max_reviews = 3;

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

const mcp_view = (server: string, tool: string, text: string, is_error: boolean): ToolView => ({ kind: "mcp", server, tool, text: text.slice(0, view_text_limit), is_error });

const invoke = async (ctx: ToolContext, call: McpCall, note: string | null): Promise<ToolResult> => {
  const label = `${call.server} ${call.tool}`;
  ctx.progress({ label: "", lines: null, output_tail: null });
  let result: McpResultText;
  try {
    result = await call_tool(call.server, call.tool, call.args, {
      signal: ctx.signal,
      timeout_ms: default_call_timeout_ms,
      on_progress: (message) => ctx.progress({ label: "", lines: null, output_tail: message }),
    });
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    const text = `[MCP tool error] ${error_text(error)}`;
    console.warn(`[mcp] ${label} failed: ${error_text(error)}`);
    return { status: "failed", text, view: mcp_view(call.server, call.tool, text, true) };
  }
  const media = await mcp_images(ctx, call.server, call.tool, result.images);
  return {
    status: result.is_error ? "failed" : "done",
    text: [...(note ? [note] : []), ...media.notes, result.text].join("\n"),
    view: mcp_view(call.server, call.tool, result.text, result.is_error),
    ...(media.images.length ? { images: media.images } : {}),
  };
};

const run_mcp = async (ctx: ToolContext, server: string, info: McpToolInfo, args: Record<string, unknown>): Promise<ToolResult> => {
  const tier = effective_tier(server, info);
  const call: McpCall = { server, tool: info.name, tier, args, scope: tier === "dangerous" ? target_scope(args) : null, trusted: is_trusted(server) };
  const server_cwd = path.resolve(ctx.settings.mcp_servers[server]?.cwd || process.cwd());
  ctx.execution_cwd = typeof args.cwd === "string" ? path.resolve(server_cwd, args.cwd) : server_cwd;
  let changed: PinChange[] = [];
  for (let pass = 1; ; pass += 1) {
    const verdict = await decide(call, ctx, mcp_review, changed);
    if (verdict.kind === "block" || verdict.kind === "denied") {
      return { status: verdict.kind === "denied" ? "denied" : "failed", text: verdict.reason, view: mcp_view(server, info.name, verdict.reason, true) };
    }
    let note: string | null = null;
    if (verdict.kind === "ask") {
      const decision = await ctx.approve({
        kind: "mcp",
        server,
        tool: info.name,
        tier,
        args_preview: JSON.stringify(args, null, 2),
        scope: call.scope,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
        ...(verdict.note ? { review: verdict.note } : {}),
        ...(changed.length ? { rechecked: true } : {}),
      });
      ctx.signal.throwIfAborted();
      if (!decision.approved) {
        const model_reason = verdict.note?.source === "model" && verdict.note.reason ? verdict.note.reason : null;
        const text = user_denied_text("tool call", decision.feedback, model_reason);
        return { status: "denied", text, view: mcp_view(server, info.name, text, true) };
      }
      record_grant(ctx.chat_id, call, decision.grant);
      note = approved_note("tool call");
    }
    const now = await changed_pins(verdict.pins);
    ctx.signal.throwIfAborted();
    if (!now.length) {
      return invoke(ctx, call, note);
    }
    if (verdict.record) {
      await ctx.review.record({ ...verdict.record, superseded: "scripts_changed" });
    }
    if (pass >= max_reviews) {
      const text = scripts_changed_text(now.map((change) => change.path));
      return { status: "denied", text, view: mcp_view(server, info.name, text, true) };
    }
    changed = now;
  }
};

const mcp_tool = (server: string, info: McpToolInfo): Tool => {
  return define_tool<Record<string, unknown>>({
    spec: { name: info.spec_name, description: build_description(server, info.name, info.description), parameters: build_parameters(info.input_schema) },
    profiles: ["main"],
    parse: (raw) => raw,
    run: (ctx, args) => run_mcp(ctx, server, info, args),
  });
};

export const mcp_tools = (): Tool[] =>
  ready_servers().flatMap((server) => server.tools.filter((tool) => tool_enabled(server.name, tool.name)).map((tool) => mcp_tool(server.name, tool)));

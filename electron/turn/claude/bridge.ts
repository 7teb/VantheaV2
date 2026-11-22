import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import package_json from "../../../package.json" with { type: "json" };
import type { ModelEntry } from "../../../shared/models.ts";
import { image_limit } from "../../model/image-limits.ts";
import { error_text } from "../../storage/coerce.ts";
import type { ContextReading, Tool } from "../../tools/types.ts";
import { run_call, type CallResult } from "../call.ts";
import type { CarrierImage } from "../carriers.ts";
import { round_profile } from "../round.ts";
import type { TurnSession } from "../session.ts";
import type { CallEntry, CallRegistry } from "./calls.ts";
import { image_marker, image_source } from "./content.ts";
import type { Gate } from "./gate.ts";
import { bare_name, server_name } from "./names.ts";

const tool_use_key = "claudecode/toolUseId";

const stopped_text = "The turn was stopped.";

const denied_text = "This tool is not available in this app.";

const max_result_chars = 500_000;

type BridgeDeps = {
  session: TurnSession;
  ended: AbortSignal;
  calls: CallRegistry;
  gate: Gate;
  closing: () => boolean;
  context: () => ContextReading;
  after_call: (entry: CallEntry, plan: boolean) => Promise<void>;
  fail: (error: unknown) => void;
};

export type Bridge = { server: McpServer; permit: CanUseTool; settled: () => Promise<void> };

type ResultContent = CallToolResult["content"];

const stopped = (): CallToolResult => ({ content: [{ type: "text", text: stopped_text }], isError: true });

const object_properties = (properties: Record<string, unknown>): Record<string, object> =>
  Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, object] => typeof entry[1] === "object" && entry[1] !== null));

const listed = (tool: Tool) => ({
  name: tool.spec.name,
  description: tool.spec.description,
  inputSchema: { ...tool.spec.parameters, properties: object_properties(tool.spec.parameters.properties) },
  annotations: { readOnlyHint: tool.concurrent },
  _meta: { "anthropic/alwaysLoad": true, "anthropic/maxResultSizeChars": max_result_chars },
});

const image_count = (model: ModelEntry): number => Math.max(0, ...image_limit(model).edges.map((edge) => edge.min_images));

const image_parts = (image: CarrierImage): ResultContent => {
  if (!("url" in image)) {
    return [{ type: "text", text: `${image.label} ${image.note}` }];
  }
  const source = image_source(image.url);
  return source
    ? [
        { type: "text", text: image.label },
        { type: "image", data: source.data, mimeType: source.media_type },
      ]
    : [{ type: "text", text: `${image.label} ${image_marker}` }];
};

const call_result = (outcome: Extract<CallResult, { aborted: false }>): CallToolResult => ({
  content: [{ type: "text", text: outcome.result_text }, ...outcome.carried.flatMap(image_parts)],
  isError: outcome.status === "failed" || outcome.status === "denied",
});

export const create_bridge = (deps: BridgeDeps): Bridge => {
  const { session, calls, gate, closing } = deps;
  const scoped: TurnSession = Object.create(session, { signal: { value: AbortSignal.any([session.signal, deps.ended]) } });
  const running = new Set<Promise<CallToolResult>>();
  const server = new McpServer({ name: server_name, version: package_json.version }, { capabilities: { tools: {} } });

  const gated_run = async (entry: CallEntry, name: string, args: Record<string, unknown>): Promise<CallResult> => {
    const profile = round_profile(session);
    const tool = session.resolve_tools(profile).find((candidate) => candidate.spec.name === name) ?? null;
    const release = await gate.enter(tool?.concurrent === true);
    try {
      if (closing()) {
        return { aborted: true };
      }
      const call = { index: entry.index, id: entry.id, name, arguments: JSON.stringify(args), engine_id: entry.call_id, args, tool };
      return await run_call(scoped, call, profile, image_count(session.model), deps.context);
    } finally {
      release();
    }
  };

  const handle = async (name: string, args: Record<string, unknown>, meta: unknown, signal: AbortSignal): Promise<CallToolResult> => {
    const entry = await calls.claim(typeof meta === "string" ? meta : null, name, args, signal);
    if (!entry || closing()) {
      return stopped();
    }
    try {
      await session.before_tools?.();
      const outcome = await gated_run(entry, name, args);
      if (outcome.aborted) {
        return stopped();
      }
      calls.record(entry, { text: outcome.result_text, carried: outcome.carried });
      if (!closing()) {
        await deps.after_call(entry, outcome.plan);
      }
      return call_result(outcome);
    } catch (error) {
      if (scoped.signal.aborted) {
        return stopped();
      }
      console.error(`[claude] call ${entry.call_id} of ${name} in chat ${session.chat_id} failed outside the tool run on args ${JSON.stringify(args).slice(0, 200)}:`, error);
      deps.fail(error);
      return { content: [{ type: "text", text: error_text(error) }], isError: true };
    }
  };

  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: session.resolve_tools(round_profile(session)).map(listed) }));

  server.server.setRequestHandler(CallToolRequestSchema, (request, extra): Promise<CallToolResult> => {
    const handled = handle(bare_name(request.params.name), request.params.arguments ?? {}, request.params._meta?.[tool_use_key], extra.signal);
    const forget = () => {
      running.delete(handled);
    };
    running.add(handled);
    handled.then(forget, forget);
    return handled;
  });

  const settled = async () => {
    while (running.size) {
      await Promise.allSettled([...running]);
    }
  };

  const permit: CanUseTool = async (name, input, options) => {
    if (options.mcpServer?.source !== "sdk" || options.mcpServer.name !== server_name) {
      console.warn(`[claude] Claude Code asked to run ${name} from ${options.mcpServer?.source ?? "its own tools"} in chat ${session.chat_id}, which is not a tool of this app, denied`);
      return { behavior: "deny", message: denied_text };
    }
    calls.announce(options.toolUseID, input);
    return { behavior: "allow", updatedInput: input };
  };

  return { server, permit, settled };
};

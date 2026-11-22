import type { AccountInfo, Options, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AssistantMessage, PermissionMode } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import { apply_events } from "../shared/apply-event.ts";
import type { ClaudeQuery, ClaudeQueryInput, ClaudeRuntime, ClaudeSessionRef } from "../electron/claude/runtime.ts";
import type { TurnHooks } from "../electron/hooks/turn-hooks.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { Tool, ToolContext, ToolResult } from "../electron/tools/types.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import type { ClaudeTurnInput } from "../electron/turn/claude/drive.ts";
import { review_stub } from "./review-stub.ts";

export const claude_model: ModelEntry = {
  id: "anthropic/claude-opus-5.5",
  claude_code: "claude-opus-5-5",
  label: "Claude Opus 5.5",
  provider: "Anthropic",
  provider_order: ["anthropic"],
  efforts: ["low", "medium", "high", "xhigh", "max"],
  default_effort: "high",
  vision: true,
  context_length: 1_000_000,
  compact_at: 0.95,
  max_output: 128_000,
  reasoning_passback: false,
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

export const settle = async (rounds = 20) => {
  for (let at = 0; at < rounds; at += 1) {
    await tick();
  }
};

export const until = async (check: () => boolean, label = "condition") => {
  for (let at = 0; at < 2000 && !check(); at += 1) {
    await tick();
  }
  if (!check()) {
    throw new Error(`timed out waiting for ${label}`);
  }
};

export type FakeQuery = ClaudeQuery & {
  options: Options;
  pushed: SDKUserMessage[];
  send: (...messages: SDKMessage[]) => void;
  finish: () => void;
  crash: (error: Error) => void;
  next_push: () => Promise<SDKUserMessage>;
  client: () => Promise<Client>;
  call: (name: string, args: Record<string, unknown>, tool_use_id?: string) => Promise<CallOutcome>;
  permit: (name: string, input: Record<string, unknown>, tool_use_id: string, source?: string, server?: string) => Promise<PermissionResult | null>;
  interrupts: number;
  closed: boolean;
  stderr: string;
};

export type CallOutcome = { text: string; content: { type: string; text?: string; data?: string; mimeType?: string }[]; is_error: boolean };

type Step = { kind: "message"; message: SDKMessage } | { kind: "end" } | { kind: "crash"; error: Error };

type QueryFixture = { exit_hold: Promise<void> | null; account: AccountInfo };

const fake_query = (input: ClaudeQueryInput, fixture: QueryFixture): FakeQuery => {
  const steps: Step[] = [];
  let waiting: (() => void) | null = null;
  let exit: () => void = () => undefined;
  const process_exit = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const exited = Promise.all([process_exit, fixture.exit_hold]).then(() => undefined);
  const push_waiters: (() => void)[] = [];
  let consumed_pushes = 0;
  let connected: Promise<Client> | null = null;

  const enqueue = (step: Step) => {
    steps.push(step);
    const wake = waiting;
    waiting = null;
    wake?.();
  };

  const iterator: AsyncIterator<SDKMessage> = {
    next: async () => {
      while (!query.closed && !steps.length) {
        await new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
      const step = query.closed ? null : steps.shift();
      if (step?.kind === "message") {
        return { done: false, value: step.message };
      }
      exit();
      if (step?.kind === "crash") {
        throw step.error;
      }
      return { done: true, value: undefined };
    },
  };

  const connect = async (): Promise<Client> => {
    const config = input.options.mcpServers?.vantheax;
    if (config?.type !== "sdk") {
      throw new Error("the options carry no in-process vantheax server");
    }
    const [client_side, server_side] = InMemoryTransport.createLinkedPair();
    await config.instance.connect(server_side);
    const client = new Client({ name: "fake-claude", version: "1.0.0" });
    await client.connect(client_side);
    return client;
  };

  const query: FakeQuery = {
    options: input.options,
    pushed: [],
    interrupts: 0,
    closed: false,
    stderr: "",
    [Symbol.asyncIterator]: () => iterator,
    interrupt: async () => {
      query.interrupts += 1;
    },
    close: () => {
      query.closed = true;
      enqueue({ kind: "end" });
      exit();
    },
    account: async () => fixture.account,
    exited,
    stderr_tail: () => query.stderr,
    send: (...messages) => messages.forEach((message) => enqueue({ kind: "message", message })),
    finish: () => enqueue({ kind: "end" }),
    crash: (error) => enqueue({ kind: "crash", error }),
    next_push: async () => {
      while (query.pushed.length <= consumed_pushes) {
        await new Promise<void>((resolve) => push_waiters.push(resolve));
      }
      consumed_pushes += 1;
      return query.pushed[consumed_pushes - 1];
    },
    client: () => (connected ??= connect()),
    call: async (name, args, tool_use_id) => {
      const client = await query.client();
      const result = await client.callTool({ name: `mcp__vantheax__${name}`, arguments: args, ...(tool_use_id ? { _meta: { "claudecode/toolUseId": tool_use_id } } : {}) });
      const content = Array.isArray(result.content) ? (result.content as CallOutcome["content"]) : [];
      return { text: content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n"), content, is_error: result.isError === true };
    },
    permit: async (name, args, tool_use_id, source = "sdk", server = "vantheax") => {
      const can = input.options.canUseTool;
      if (!can) {
        throw new Error("the options carry no canUseTool");
      }
      return can(name, args, { signal: new AbortController().signal, toolUseID: tool_use_id, requestId: `req-${tool_use_id}`, mcpServer: { name: server, source } });
    },
  };

  void (async () => {
    for await (const message of input.prompt) {
      query.pushed.push(message);
      for (const wake of push_waiters.splice(0)) {
        wake();
      }
    }
  })();

  return query;
};

export type FakeRuntime = {
  runtime: ClaudeRuntime;
  queries: FakeQuery[];
  opened: (count?: number) => Promise<FakeQuery>;
  deleted: { session_id: string; cwd: string }[];
  auth_failures: () => number;
  open_error: Error | null;
  exit_hold: Promise<void> | null;
  account: AccountInfo;
};

export const fake_runtime = (prefixes: readonly string[] = ["You've hit your"]): FakeRuntime => {
  const queries: FakeQuery[] = [];
  let failures = 0;
  const fake: FakeRuntime = {
    queries,
    deleted: [],
    open_error: null,
    exit_hold: null,
    account: { email: "user@example.invalid", subscriptionType: "max", apiKeySource: "none", apiProvider: "firstParty" },
    auth_failures: () => failures,
    opened: async (count = 1) => {
      await until(() => queries.length >= count, `query ${count}`);
      return queries[count - 1];
    },
    runtime: {
      open: (input) => {
        if (fake.open_error) {
          throw fake.open_error;
        }
        const query = fake_query(input, { exit_hold: fake.exit_hold, account: fake.account });
        queries.push(query);
        return query;
      },
      delete_session: async (session_id, cwd) => {
        fake.deleted.push({ session_id, cwd });
      },
      usage_limit_prefixes: prefixes,
      auth_failed: () => {
        failures += 1;
      },
    },
  };
  return fake;
};

export type ClaudeHarness = {
  session: TurnSession;
  events: StreamEventBody[];
  late: StreamEventBody[];
  controller: AbortController;
  api_messages: ApiMessage[];
  saved: (ClaudeSessionRef | null)[];
  input: ClaudeTurnInput;
  stream_calls: () => number;
};

export const claude_harness = (tools: Tool[], over: Partial<TurnSession> = {}, input: Partial<ClaudeTurnInput> = {}): ClaudeHarness => {
  const controller = new AbortController();
  const events: StreamEventBody[] = [];
  const late: StreamEventBody[] = [];
  const saved: (ClaudeSessionRef | null)[] = [];
  const api_messages: ApiMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "do the thing" },
  ];
  let streams = 0;
  let ended = false;
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id: "chat-1",
    message_id: "turn-1",
    user_request: "do the thing",
    project_root: "C:/project",
    settings: {} as Settings,
    model: claude_model,
    effort: "high",
    mode: "auto" as PermissionMode,
    plan: false,
    signal: controller.signal,
    emit: (body) => {
      if (ended) {
        late.push(body);
        return;
      }
      ended = body.type === "end";
      events.push(body);
    },
    stream: async () => {
      streams += 1;
      throw new Error("the Claude driver must not call session.stream");
    },
    resolve_tools: () => tools,
    side_model: async () => "",
    review: review_stub(),
    wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
    ...over,
  };
  const turn_input: ClaudeTurnInput = {
    api_messages,
    fresh_count: 1,
    compact_only: false,
    title: "Chat title",
    turn_id: "turn-1",
    previous_turn_id: null,
    stored: null,
    save: async (ref) => {
      saved.push(ref);
    },
    ...input,
  };
  return { session, events, late, controller, api_messages: turn_input.api_messages, saved, input: turn_input, stream_calls: () => streams };
};

export type ToolRun = (call: { args: Record<string, unknown>; ctx: ToolContext }) => Promise<ToolResult>;

export const make_tool = (name: string, run: ToolRun, concurrent = false, parameters?: Tool["spec"]["parameters"]): Tool => ({
  spec: { name, description: `${name} tool`, parameters: parameters ?? { type: "object", properties: { path: { type: "string" } } } },
  profiles: ["main", "plan", "explore", "worker"],
  concurrent,
  available: () => true,
  execute: (ctx, args) => run({ args, ctx }),
});

export const test_hooks = (over: Partial<TurnHooks> = {}, seen: string[] = []): TurnHooks => ({
  pre_tool: async (call) => {
    seen.push(`pre ${call.name} ${call.tool_use_id}`);
    return { kind: "run", runs: [] };
  },
  post_tool: async (call, end) => {
    seen.push(`post ${call.name}`);
    return { kind: "done", result_text: end.text, runs: [] };
  },
  stop: async () => ({ kind: "end" }),
  stop_failure: async () => undefined,
  ...over,
});

export const ends = (events: StreamEventBody[]) => events.filter((event) => event.type === "end");

const blank_message: AssistantMessage = {
  id: "turn-1", role: "assistant", model: claude_model.id, effort: "high", mode: "auto", plan: false, created_at: "2026-11-21T10:00:00.000Z", ended_at: null,
  status: "streaming", steps: [], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0,
};

export const transcript = (events: StreamEventBody[]): AssistantMessage =>
  apply_events(blank_message, events.map((body, index) => ({ ...body, seq: index + 1, at: index + 1 })));

export const open_steps = (events: StreamEventBody[]) =>
  transcript(events).steps.filter((step) => step.kind === "tool" && (step.status === "queued" || step.status === "running" || step.status === "awaiting_approval" || step.status === "drafting"));

const sdk = (value: unknown): SDKMessage => value as SDKMessage;

const usage = (over: Record<string, number | null> = {}) => ({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, ...over });

export const init = (session_id = "sess-1", api_key_source = "none") =>
  sdk({ type: "system", subtype: "init", session_id, apiKeySource: api_key_source, claude_code_version: "2.1.330", cwd: "C:/project", tools: ["mcp__vantheax__read"], mcp_servers: [], model: "claude-opus-5-5", permissionMode: "default", slash_commands: [], output_style: "default", skills: [], plugins: [], uuid: "u-init" });

export const start = (id: string, over: Record<string, number | null> = {}, uuids?: string[]) =>
  sdk({ type: "stream_event", parent_tool_use_id: null, uuid: `u-start-${id}`, session_id: "sess-1", event: { type: "message_start", message: { id, model: "claude-opus-5-5", content: [], usage: usage(over) } }, ...(uuids ? { user_message_uuids: uuids, user_message_uuid: uuids.at(-1) } : {}) });

const event = (value: unknown) => sdk({ type: "stream_event", parent_tool_use_id: null, uuid: "u-event", session_id: "sess-1", event: value });

export const text_block = (index: number) => event({ type: "content_block_start", index, content_block: { type: "text", text: "" } });

export const thinking_block = (index: number) => event({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });

export const tool_block = (index: number, id: string, name: string) => event({ type: "content_block_start", index, content_block: { type: "tool_use", id, name: `mcp__vantheax__${name}`, input: {} } });

export const raw_tool_block = (index: number, id: string, name: string) => event({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } });

export const text_delta = (index: number, text: string) => event({ type: "content_block_delta", index, delta: { type: "text_delta", text } });

export const thinking_delta = (index: number, thinking: string) => event({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } });

export const json_delta = (index: number, partial_json: string) => event({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } });

export const block_stop = (index: number) => event({ type: "content_block_stop", index });

export const delta = (stop_reason: string | null, over: Record<string, number | null> = { output_tokens: 40 }) =>
  event({ type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: 40, ...over } });

export const stop = () => event({ type: "message_stop" });

export type Content = { type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "tool_use"; id: string; name: string; input: unknown };

export const assistant = (id: string, content: Content[], over: Record<string, unknown> = {}) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: over.uuid ?? `u-${id}-${content.length}`, session_id: "sess-1", message: { id, model: "claude-opus-5-5", role: "assistant", content, stop_reason: null, usage: usage() }, ...over });

export const synthetic = (text: string, error: string) =>
  sdk({ type: "assistant", parent_tool_use_id: null, uuid: "u-synthetic", session_id: "sess-1", error, message: { id: "msg-synthetic", model: "<synthetic>", role: "assistant", content: [{ type: "text", text }], stop_reason: null, usage: usage() } });

export const tool_use = (id: string, name: string, input: unknown): Content => ({ type: "tool_use", id, name: `mcp__vantheax__${name}`, input });

export const tool_result = (tool_use_id: string, text: string) =>
  sdk({ type: "user", parent_tool_use_id: null, uuid: `u-result-${tool_use_id}`, session_id: "sess-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id, content: text, is_error: true }] } });

export const result = (over: Record<string, unknown> = {}) =>
  sdk({ type: "result", subtype: "success", is_error: false, result: "done", stop_reason: "end_turn", num_turns: 1, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 1.5, usage: usage(), modelUsage: {}, permission_denials: [], uuid: "u-result", session_id: "sess-1", ...over });

export const error_result = (over: Record<string, unknown> = {}) =>
  sdk({ type: "result", subtype: "error_during_execution", is_error: true, stop_reason: null, num_turns: 1, duration_ms: 1, duration_api_ms: 1, total_cost_usd: 0, usage: usage(), modelUsage: {}, permission_denials: [], errors: [], uuid: "u-error", session_id: "sess-1", ...over });

export const system = (subtype: string, over: Record<string, unknown> = {}) => sdk({ type: "system", subtype, uuid: `u-${subtype}`, session_id: "sess-1", ...over });

export const rate_limit = (info: Record<string, unknown>) => sdk({ type: "rate_limit_event", rate_limit_info: info, uuid: "u-limit", session_id: "sess-1" });

export const text_response = (id: string, text: string, stop_reason = "end_turn"): SDKMessage[] => [start(id), text_block(0), text_delta(0, text), assistant(id, [{ type: "text", text }]), block_stop(0), delta(stop_reason), stop()];

export type PlannedCall = { id: string; name: string; input: Record<string, unknown> };

export const tool_response = (id: string, calls: PlannedCall[], text = ""): SDKMessage[] => [
  start(id),
  ...(text ? [text_block(0), text_delta(0, text), assistant(id, [{ type: "text", text }]), block_stop(0)] : []),
  ...calls.flatMap((call, at) => {
    const index = at + (text ? 1 : 0);
    return [tool_block(index, call.id, call.name), json_delta(index, JSON.stringify(call.input)), assistant(id, [tool_use(call.id, call.name, call.input)], { uuid: `u-${id}-tool-${at}` }), block_stop(index)];
  }),
  delta("tool_use"),
  stop(),
];

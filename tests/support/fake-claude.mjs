import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const version = "2.1.330";
const protocol_version = "2025-11-25";
const argv = process.argv.slice(2);
const log_file = process.env.VX_FAKE_CLAUDE_LOG ?? "";

const log = (entry) => {
  if (log_file) {
    fs.appendFileSync(log_file, `${JSON.stringify(entry)}\n`);
  }
};

log({ kind: "argv", argv, cwd: process.cwd(), pid: process.pid });
log({ kind: "env", names: Object.keys(process.env).sort() });

const read_scenario = () => {
  const file = process.env.VX_FAKE_CLAUDE_SCENARIO ?? "";
  const value = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return { auth: value.auth ?? "signed_in", turns: Array.isArray(value.turns) ? value.turns : [] };
};

const scenario = read_scenario();

const auth_states = {
  signed_in: { code: 0, status: { loggedIn: true, authMethod: "claude.ai", email: "fake@example.invalid", subscriptionType: "max" } },
  signed_out: { code: 1, status: { loggedIn: false, authMethod: "none" } },
  api_key: { code: 0, status: { loggedIn: true, authMethod: "api_key" } },
};

const flag = (name) => {
  for (const [at, arg] of argv.entries()) {
    if (arg === name) {
      return argv[at + 1] ?? "";
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return null;
};

const run_session = () => {
  const resumed = flag("--resume");
  const session_id = flag("--session-id") ?? resumed ?? randomUUID();
  const model = flag("--model") ?? "claude-opus-5-5";
  const prefixed = process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX !== "1";
  const api_key_source = scenario.auth === "api_key" ? "ANTHROPIC_API_KEY" : "none";
  const interrupted = { interrupted: true };
  const pending = new Map();
  const queue = [];
  const counters = { request: 0, message: 0, tool: 0, turn: 0, mcp: 0 };
  let initialized = null;
  let tools = null;
  let playing = null;
  let draining = false;

  const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

  const frame = (value) => ({ ...value, session_id, uuid: randomUUID() });

  const transcript_file = () => {
    const config = process.env.CLAUDE_CONFIG_DIR;
    return config ? path.join(config, "projects", fs.realpathSync(process.cwd()).replace(/[^a-zA-Z0-9]/g, "-"), `${session_id}.jsonl`) : null;
  };

  const record = (entry) => {
    const file = transcript_file();
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify({ ...entry, sessionId: session_id, timestamp: new Date().toISOString() })}\n`);
    }
  };

  const wait = async (request) => {
    counters.request += 1;
    const request_id = `fake-${counters.request}`;
    const asked = new Promise((resolve) => {
      pending.set(request_id, resolve);
      send({ type: "control_request", request_id, request });
    });
    const answer = await Promise.race([asked, playing.stopped]);
    return answer === interrupted ? null : answer;
  };

  const server_name = () => initialized?.sdkMcpServers?.[0] ?? "vantheax";

  const tool_name = (name) => (prefixed ? `mcp__${server_name()}__${name}` : name);

  const mcp_message = (message) => ({ subtype: "mcp_message", server_name: server_name(), message: { jsonrpc: "2.0", ...message } });

  const mcp = async (method, params) => {
    counters.mcp += 1;
    const answer = await wait(mcp_message({ id: counters.mcp, method, ...(params ? { params } : {}) }));
    return answer?.response?.mcp_response ?? null;
  };

  const handshake = async () => {
    if (tools) {
      return true;
    }
    if (!(await mcp("initialize", { protocolVersion: protocol_version, capabilities: {}, clientInfo: { name: "fake-claude", version } }))) {
      return false;
    }
    send({ type: "control_request", request_id: `fake-note-${counters.mcp}`, request: mcp_message({ method: "notifications/initialized" }) });
    const listed = await mcp("tools/list");
    tools = listed ? (listed.result?.tools ?? []).map((tool) => tool.name) : null;
    return tools !== null;
  };

  const usage = (output) => ({ input_tokens: 1200, output_tokens: output, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 });

  const stamp = () => (playing.uuids.length ? { user_message_uuid: playing.uuids.at(-1), user_message_uuids: [...playing.uuids] } : {});

  const stream = (event, stamped = false) => send(frame({ type: "stream_event", event, parent_tool_use_id: null, ...(stamped ? stamp() : {}) }));

  const assistant_message = (id, content, over = {}) => ({ id, type: "message", role: "assistant", model, content, stop_reason: null, stop_sequence: null, usage: usage(1), ...over });

  const open_response = () => {
    if (!playing.response) {
      counters.message += 1;
      playing.response = { id: `msg_fake_${counters.message}`, index: 0, content: [] };
      stream({ type: "message_start", message: assistant_message(playing.response.id, []) }, true);
    }
    return playing.response;
  };

  const close_response = (stop_reason) => {
    const response = playing.response;
    if (!response) {
      return;
    }
    playing.response = null;
    stream({ type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 40 } });
    stream({ type: "message_stop" });
    record({ type: "assistant", message: { id: response.id, role: "assistant", content: response.content } });
  };

  const play_block = (start, deltas, block) => {
    const response = open_response();
    const index = response.index++;
    stream({ type: "content_block_start", index, content_block: start });
    for (const delta of deltas) {
      stream({ type: "content_block_delta", index, delta });
    }
    response.content.push(block);
    send(frame({ type: "assistant", parent_tool_use_id: null, message: assistant_message(response.id, [block]) }));
    stream({ type: "content_block_stop", index });
  };

  const halves = (text) => [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))].filter(Boolean);

  const play_text = (text) => {
    play_block({ type: "text", text: "" }, halves(text).map((part) => ({ type: "text_delta", text: part })), { type: "text", text });
    playing.last_text = text;
    return true;
  };

  const play_thinking = (thinking) => {
    const deltas = [...halves(thinking).map((part) => ({ type: "thinking_delta", thinking: part })), { type: "signature_delta", signature: "fake-signature" }];
    play_block({ type: "thinking", thinking: "", signature: "" }, deltas, { type: "thinking", thinking, signature: "fake-signature" });
    return true;
  };

  const tool_result = (id, content, is_error) => {
    const message = { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error }] };
    send(frame({ type: "user", parent_tool_use_id: null, message, tool_use_result: content }));
    record({ type: "user", message });
  };

  const play_tool = async (name, input) => {
    counters.tool += 1;
    const id = `toolu_fake_${counters.tool}`;
    const listed_name = tool_name(name);
    play_block({ type: "tool_use", id, name: listed_name, input: {} }, [{ type: "input_json_delta", partial_json: JSON.stringify(input) }], { type: "tool_use", id, name: listed_name, input });
    close_response("tool_use");
    const permission = await wait({ subtype: "can_use_tool", tool_name: listed_name, input, tool_use_id: id, mcp_server: { name: server_name(), source: "sdk" } });
    if (!permission) {
      return false;
    }
    const decision = permission.response ?? {};
    if (decision.behavior !== "allow") {
      send(frame({ type: "system", subtype: "permission_denied", tool_name: listed_name, tool_use_id: id, message: decision.message ?? "denied" }));
      tool_result(id, [{ type: "text", text: decision.message ?? "denied" }], true);
      return true;
    }
    const called = await mcp("tools/call", { name, arguments: decision.updatedInput ?? input, _meta: { "claudecode/toolUseId": id, "claudecode/sessionId": session_id } });
    if (!called) {
      return false;
    }
    const result = called.result ?? { content: [{ type: "text", text: called.error?.message ?? "no result" }], isError: true };
    tool_result(id, result.content ?? [], result.isError === true);
    return true;
  };

  const result_frame = (over) =>
    frame({ type: "result", subtype: "success", is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, stop_reason: "end_turn", total_cost_usd: 0.25, usage: usage(40), modelUsage: {}, permission_denials: [], ...stamp(), ...over });

  const end_turn = (over = {}) => {
    close_response("end_turn");
    send(result_frame({ result: playing.last_text, ...over }));
    playing.done = true;
    return true;
  };

  const api_error = (text, error, status) => {
    close_response("end_turn");
    counters.message += 1;
    const message = assistant_message(`msg_synthetic_${counters.message}`, [{ type: "text", text }], { model: "<synthetic>", stop_reason: "stop_sequence", stop_sequence: "", usage: usage(0) });
    send(frame({ type: "assistant", parent_tool_use_id: null, error, message }));
    return end_turn({ is_error: true, result: text, stop_reason: "stop_sequence", api_error_status: status, terminal_reason: "api_error" });
  };

  const play_compact = async (trigger) => {
    send(frame({ type: "system", subtype: "status", status: "compacting" }));
    const callback = initialized?.hooks?.PostCompact?.[0]?.hookCallbackIds?.[0];
    const input = { hook_event_name: "PostCompact", session_id, transcript_path: transcript_file() ?? "", cwd: process.cwd(), trigger, compact_summary: "Summary written by the fake Claude Code." };
    if (callback && !(await wait({ subtype: "hook_callback", callback_id: callback, input }))) {
      return false;
    }
    send(frame({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger, pre_tokens: 120000, post_tokens: 8000, duration_ms: 5 } }));
    send(frame({ type: "system", subtype: "status", status: null, compact_result: "success" }));
    return true;
  };

  const usage_limit = () => {
    const rate_limit_info = { status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: "five_hour", isUsingOverage: false, overageStatus: "rejected" };
    send(frame({ type: "rate_limit_event", rate_limit_info }));
    return api_error("You've hit your session limit · resets 3:45pm", "rate_limit", 429);
  };

  const steps = {
    text: (step) => play_text(String(step.text)),
    thinking: (step) => play_thinking(String(step.thinking)),
    tool: (step) => play_tool(String(step.tool), step.input ?? {}),
    compact: (step, command) => play_compact(command === "/compact" ? "manual" : "auto"),
    result: (step) => end_turn(typeof step.result === "string" ? { result: step.result } : {}),
    auth_error: () => api_error("Not logged in · Please run /login", "authentication_failed", 401),
    usage_limit,
    missing_session: () => true,
  };

  const play_step = async (step, command) => {
    const kind = Object.keys(steps).find((name) => name in step);
    if (!kind) {
      log({ kind: "unknown_step", step });
      return true;
    }
    return steps[kind](step, command);
  };

  const missing_session = (turn) => {
    if (resumed === null || !turn.some((step) => "missing_session" in step)) {
      return false;
    }
    log({ kind: "missing_session", session_id });
    const failed = result_frame({ subtype: "error_during_execution", is_error: true, errors: [`No conversation found with session ID: ${session_id}`], stop_reason: null, terminal_reason: "completed" });
    process.stdout.write(`${JSON.stringify(failed)}\n`, () => process.exit(1));
    return true;
  };

  const init_frame = () =>
    frame({ type: "system", subtype: "init", apiKeySource: api_key_source, claude_code_version: version, cwd: process.cwd(), tools: (tools ?? []).map(tool_name), mcp_servers: [{ name: server_name(), status: "connected" }], model, permissionMode: "default", slash_commands: ["compact"], output_style: "default", skills: [], plugins: [] });

  const play = async (message) => {
    const turn = scenario.turns[counters.turn] ?? [{ text: "Done." }];
    counters.turn += 1;
    let stop = () => undefined;
    const stopped = new Promise((resolve) => {
      stop = () => resolve(interrupted);
    });
    playing = { uuids: message.uuid ? [message.uuid] : [], response: null, last_text: "", done: false, interrupted: false, stopped, stop };
    if (missing_session(turn)) {
      playing.done = true;
      return;
    }
    record({ type: "user", uuid: message.uuid, message: message.message });
    const ready = await handshake();
    if (ready) {
      send(init_frame());
    } else {
      log({ kind: "handshake_failed" });
    }
    const command = typeof message.message?.content === "string" ? message.message.content : "";
    for (const step of ready ? turn : []) {
      if (!(await play_step(step, command)) || playing.done) {
        break;
      }
    }
    if (playing.interrupted) {
      playing.response = null;
      send(result_frame({ subtype: "error_during_execution", is_error: true, errors: [], stop_reason: null, terminal_reason: "aborted_tools" }));
    } else if (!playing.done) {
      end_turn();
    }
    playing = null;
  };

  const drain = async () => {
    if (draining) {
      return;
    }
    draining = true;
    for (let message = queue.shift(); message; message = queue.shift()) {
      await play(message);
    }
    draining = false;
  };

  const initialize_response = () => ({
    commands: [{ name: "compact", description: "Compact the conversation", argumentHint: "" }],
    agents: [],
    output_style: "default",
    available_output_styles: ["default"],
    models: [{ value: model, displayName: model, description: "fake model", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true }],
    account: { email: "fake@example.invalid", subscriptionType: "max", tokenSource: "claude.ai", apiKeySource: api_key_source, apiProvider: "firstParty" },
    claude_code_version: version,
    pending_permission_requests: [],
    pending_user_dialog_requests: [],
    pending_elicitation_requests: [],
  });

  const answer = (request_id, response) => send({ type: "control_response", response: { subtype: "success", request_id, response } });

  const on_control = (message) => {
    const request = message.request ?? {};
    if (request.subtype === "initialize") {
      initialized = request;
      answer(message.request_id, initialize_response());
      return;
    }
    if (request.subtype !== "interrupt") {
      answer(message.request_id, {});
      return;
    }
    answer(message.request_id, { still_queued: [] });
    if (playing && !playing.done) {
      playing.interrupted = true;
      playing.stop();
    }
  };

  const on_frame = (message) => {
    if (message.type === "control_request") {
      on_control(message);
      return;
    }
    if (message.type === "control_response") {
      const resolve = pending.get(message.response?.request_id);
      pending.delete(message.response?.request_id);
      resolve?.(message.response);
      return;
    }
    if (message.type !== "user") {
      return;
    }
    if (playing && !playing.done) {
      if (message.uuid) {
        playing.uuids.push(message.uuid);
      }
      record({ type: "user", uuid: message.uuid, message: message.message });
      return;
    }
    queue.push(message);
    void drain();
  };

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (line.trim()) {
      const message = JSON.parse(line);
      log({ kind: "in", frame: message });
      on_frame(message);
    }
  });
  input.on("close", () => {
    log({ kind: "stdin_closed" });
    process.exit(0);
  });
};

if (argv.includes("--version")) {
  process.stdout.write(`${version} (Claude Code)\n`, () => process.exit(0));
} else if (argv[0] === "auth" && argv[1] === "status") {
  const state = auth_states[scenario.auth] ?? auth_states.signed_in;
  process.stdout.write(`${JSON.stringify(state.status, null, 2)}\n`, () => process.exit(state.code));
} else {
  run_session();
}

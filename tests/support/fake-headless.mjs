import http from "node:http";

const args = process.argv.slice(2);
const switch_value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const token = process.env.VANTHEAX_API_TOKEN ?? "";

console.log("[boot] fake headless instance starting");
console.log(JSON.stringify({ vantheax: "log", message: "not the ready line" }));
console.log("{ this line is not json");

if (args.includes("--fake-foreign-ready")) {
  console.log(JSON.stringify({ vantheax: "ready", api: 1, url: "http://198.51.100.7:8080", pid: process.pid }));
}

if (args.includes("--fake-fail")) {
  console.error(JSON.stringify({ vantheax: "error", step: "fake", message: "fake startup failure" }));
  process.exit(1);
}

if (!args.includes("--vx-serve") || token.length < 32) {
  console.error(JSON.stringify({ vantheax: "error", step: "switches", message: "missing --vx-serve or VANTHEAX_API_TOKEN" }));
  process.exit(2);
}

const boot = "f00d";
let seq = 0;
let counter = 0;
const frames = [];
const streams = new Set();
const sessions = new Map();
const pending = new Map();
const state = { prompts: [], uploads: [], replies: [], holds: [], stops: [], steers: [], answers: [], plans: [], event_queries: [] };

const now = () => new Date(Date.UTC(2026, 10, 20, 12, 0, counter)).toISOString();
const next_id = (prefix) => `${prefix}_${(counter += 1)}`;

const meta_of = (session) => ({ ...session.meta, message_count: session.messages.length, streaming: session.streaming });

const frame_text = (type, data, id) => `${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const publish = (type, chat_id, data) => {
  seq += 1;
  const id = `${boot}.${seq}`;
  const text = frame_text(type, data, id);
  frames.push({ seq, chat_id, text });
  for (const stream of streams) {
    if (!stream.session || stream.session === chat_id) {
      stream.response.write(text);
    }
  }
};

const assistant = (id, status, text) => ({
  id,
  role: "assistant",
  model: "fake/model",
  effort: "medium",
  mode: "auto",
  plan: false,
  created_at: now(),
  ended_at: status === "streaming" ? null : now(),
  status,
  steps: text ? [{ id: `${id}_text`, round: 2, kind: "text", text }] : [],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  usage: { prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 5, rounds: 2 },
  last_seq: 0,
});

const turn_event = (session, message_id, body) => {
  publish("turn.event", session.meta.id, { ...body, seq: (session.turn_seq += 1), at: Date.now(), chat_id: session.meta.id, message_id });
};

const finish = (session, run) => {
  const message = assistant(run.run_id, "done", run.answer);
  session.messages = session.messages.map((entry) => (entry.id === run.run_id ? message : entry));
  turn_event(session, run.run_id, { type: "text", round: 2, delta: run.answer });
  turn_event(session, run.run_id, { type: "usage", round: 2, prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 5 });
  turn_event(session, run.run_id, { type: "end", status: "done", error: null });
  session.streaming = false;
  publish("session.updated", session.meta.id, meta_of(session));
  run.settled = true;
  publish("run.settled", session.meta.id, { session_id: session.meta.id, run_id: run.run_id, status: "done" });
};

const start_run = (session, body) => {
  const run_id = next_id("msg");
  const user_message_id = next_id("user");
  const run = { run_id, text: body.text, answer: `fake answer: ${body.text}`, settled: false, started_at: now() };
  session.runs.set(run_id, run);
  session.messages.push({ id: user_message_id, role: "user", text: body.text, attachments: [], origin: "user", created_at: now() });
  session.messages.push(assistant(run_id, "streaming", ""));
  session.streaming = true;
  setTimeout(() => {
    publish("session.appended", session.meta.id, { chat_id: session.meta.id, message: session.messages.at(-1) });
    turn_event(session, run_id, { type: "tool_call", round: 1, index: 0, call_id: "c1_0", name: "read_file", args: { path: "a.ts" } });
    turn_event(session, run_id, { type: "tool_start", call_id: "c1_0" });
    if (body.text.includes("approve")) {
      const request = { kind: "command", command: "npm test", cwd: session.meta.project_path, background: false, review: null, grant_prefix: null };
      pending.set("m:c1_0", { session, run, info: { approval_id: "m:c1_0", source: "main", agent_id: null, run_id: null, call_id: "c1_0", request } });
      turn_event(session, run_id, { type: "tool_approval", call_id: "c1_0", request });
      return;
    }
    finish(session, run);
  }, 5);
  return { run_id, user_message_id, message_id: run_id };
};

const run_result = (session, run) => {
  const message = session.messages.find((entry) => entry.id === run.run_id);
  const asks = run.text.includes("ask");
  return {
    run_id: run.run_id,
    session_id: session.meta.id,
    status: run.settled ? "done" : "running",
    error: null,
    text: run.settled ? run.answer : "",
    messages: [message],
    needs_input: {
      questions: asks ? [{ id: `${run.run_id}:c1_0:0`, title: "Which file?", options: ["a.ts", "b.ts"], message_id: run.run_id, call_id: "c1_0", index: 0 }] : [],
      approvals: [],
      plan_message_id: null,
    },
    active: { turn: !run.settled, agents: 0, workflows: 0, background: 0, queued: 0 },
    changed_files: [],
    usage: message.usage,
    started_at: run.started_at,
    ended_at: run.settled ? now() : null,
  };
};

const send_json = (response, status, value) => {
  if (value === undefined) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const fail = (response, status, code, message) => send_json(response, status, { error: { code, message } });

const read_body = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const open_events = (request, response, url) => {
  const session = url.searchParams.get("session");
  const last = request.headers["last-event-id"] || url.searchParams.get("last") || "";
  state.event_queries.push({ session, last });
  response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
  const after = last.startsWith(`${boot}.`) ? Number(last.slice(boot.length + 1)) : null;
  response.write(frame_text("hello", { boot, api: 1 }, `${boot}.${after ?? seq}`));
  if (last && after === null) {
    response.write(frame_text("resync", null));
  }
  for (const frame of after === null ? [] : frames.filter((entry) => entry.seq > after)) {
    if (!session || frame.chat_id === session) {
      response.write(frame.text);
    }
  }
  const stream = { session, response };
  streams.add(stream);
  response.on("close", () => streams.delete(stream));
};

const session_route = async (request, response, session, rest, url) => {
  const [action, target, extra] = rest;
  const method = request.method;
  if (!action && method === "GET") {
    return send_json(response, 200, { ...meta_of(session), summary: null, messages: session.messages, questions: {} });
  }
  if (!action && method === "DELETE") {
    sessions.delete(session.meta.id);
    return send_json(response, 204);
  }
  if (action === "prompt" && method === "POST") {
    const body = JSON.parse((await read_body(request)).toString("utf8"));
    if (session.streaming) {
      return fail(response, 409, "session_busy", "a turn is active");
    }
    if (body.model === "bogus/model") {
      return fail(response, 400, "unknown_model", "unknown model bogus/model");
    }
    state.prompts.push({ session_id: session.meta.id, body });
    return send_json(response, 202, start_run(session, body));
  }
  if (action === "runs" && method === "GET") {
    const run = session.runs.get(target);
    return run ? send_json(response, 200, run_result(session, run)) : fail(response, 404, "not_found", `run ${target} not found`);
  }
  if (action === "stop" && method === "POST") {
    state.stops.push(session.meta.id);
    return send_json(response, 204);
  }
  if (action === "steer" && method === "POST") {
    state.steers.push(JSON.parse((await read_body(request)).toString("utf8")));
    return send_json(response, 204);
  }
  if (action === "approvals" && !target && method === "GET") {
    return send_json(response, 200, [...pending.values()].filter((entry) => entry.session === session).map((entry) => entry.info));
  }
  if (action === "approvals" && target && method === "POST") {
    const entry = pending.get(decodeURIComponent(target));
    if (!entry) {
      return fail(response, 404, "not_found", `approval ${target} is not pending`);
    }
    if (extra === "hold") {
      state.holds.push(entry.info.approval_id);
      return send_json(response, 204);
    }
    state.replies.push({ approval_id: entry.info.approval_id, reply: JSON.parse((await read_body(request)).toString("utf8")) });
    pending.delete(entry.info.approval_id);
    send_json(response, 204);
    turn_event(session, entry.run.run_id, { type: "tool_end", call_id: "c1_0", status: "done", view: null, error: null, result_text: "ok" });
    return finish(session, entry.run);
  }
  if (action === "questions" && method === "GET") {
    return send_json(response, 200, []);
  }
  if (action === "questions" && method === "POST") {
    const body = JSON.parse((await read_body(request)).toString("utf8"));
    state.answers.push(body);
    return body.answers ? send_json(response, 202, start_run(session, { text: "answered" })) : send_json(response, 204);
  }
  if (action === "plan" && target === "accept" && method === "POST") {
    state.plans.push(JSON.parse((await read_body(request)).toString("utf8")));
    return send_json(response, 202, start_run(session, { text: "implement" }));
  }
  if (action === "diff" && method === "GET") {
    const path = url.searchParams.get("path");
    return send_json(response, 200, path ? { kind: "unchanged" } : [{ kind: "none" }]);
  }
  return fail(response, 404, "not_found", `${method} ${url.pathname} not found`);
};

const route = async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/fake/launch") {
    return send_json(response, 200, { argv: args, token_length: token.length, openrouter_key: process.env.OPENROUTER_API_KEY ?? null });
  }
  if (url.pathname === "/fake/state") {
    return send_json(response, 200, state);
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    return fail(response, 401, "unauthorized", "missing or wrong bearer token");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "v1") {
    return fail(response, 404, "not_found", `${url.pathname} not found`);
  }
  const [, resource, id, ...rest] = parts;
  if (resource === "info") {
    return send_json(response, 200, { name: "VantheaX", version: "0.2.0", api: 1, headless: true, default_model: "fake/model", default_mode: "auto", default_approvals: "reject" });
  }
  if (resource === "events") {
    return open_events(request, response, url);
  }
  if (resource === "shutdown") {
    send_json(response, 202, {});
    return setTimeout(() => process.exit(0), 5);
  }
  if (resource === "attachments") {
    const bytes = await read_body(request);
    const name = decodeURIComponent(String(request.headers["x-vx-name"] ?? ""));
    const mime = String(request.headers["content-type"] ?? "");
    state.uploads.push({ name, mime, size: bytes.length, text: bytes.toString("utf8") });
    return send_json(response, 200, { id: `att_${state.uploads.length}_fake.txt`, kind: "file", name, mime, size: bytes.length, vision_note: null });
  }
  if (resource === "sessions" && !id && request.method === "GET") {
    return send_json(response, 200, [...sessions.values()].map(meta_of));
  }
  if (resource === "sessions" && !id && request.method === "POST") {
    const body = JSON.parse((await read_body(request)).toString("utf8"));
    const session_id = next_id("chat");
    const meta = { id: session_id, title: "Fake", project_path: body.cwd, workspace: body.cwd, pinned: false, created_at: now(), updated_at: now() };
    sessions.set(session_id, { meta, messages: [], runs: new Map(), streaming: false, turn_seq: 0 });
    return send_json(response, 200, meta_of(sessions.get(session_id)));
  }
  const session = resource === "sessions" ? sessions.get(id) : undefined;
  if (!session) {
    return fail(response, 404, "not_found", `${url.pathname} not found`);
  }
  return session_route(request, response, session, rest, url);
};

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(`[fake] ${request.method} ${request.url} failed: ${error.stack ?? error}`);
    fail(response, 500, "internal", String(error));
  });
});

server.listen(Number(switch_value("vx-port") ?? 0), "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ vantheax: "ready", api: Number(switch_value("fake-api") ?? 1), url, pid: process.pid }));
  console.log("[boot] noise after the ready line");
});

if (switch_value("vx-lease") === "stdin") {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
}

import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { json_limit, read_json, read_raw, RequestError } from "../electron/api/body.ts";
import { remember_session_options, resolve_run_options } from "../electron/api/options.ts";
import { api_handlers, check_handlers, match, route, type ApiContext } from "../electron/api/router.ts";
import { stop_runs } from "../electron/api/runs.ts";
import type { RunOptions } from "../electron/turn/run-options.ts";
import { api_routes } from "../shared/api/routes.ts";
import type { ChatMeta } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";

const token = "k".repeat(48);

const model = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id,
  label: id.toUpperCase(),
  provider: "vendor",
  provider_order: [],
  efforts: ["low", "high"],
  default_effort: "low",
  vision: false,
  context_length: 100_000,
  max_output: 8000,
  reasoning_passback: false,
  ...extra,
});

const catalog = {
  models: [model("vendor/a", { pro: { id: "vendor/a-pro", label: "A Pro" } }), model("vendor/b")],
  side: { title: "s", overseer: "s", vision: "s", reasoning_status: "s", transcription: "s", git_text: "s" },
  side_models: [],
  image_models: [],
};

const meta = (id: string, extra: Partial<ChatMeta> = {}): ChatMeta => ({
  id,
  title: "",
  project_path: "D:\\proj",
  workspace: "",
  pinned: false,
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  message_count: 0,
  streaming: false,
  ...extra,
});

type Call = { name: string; args: unknown[] };

const state = {
  calls: [] as Call[],
  log: [] as string[],
  metas: new Map<string, ChatMeta>(),
  active: new Set<string>(),
  pins: new Map<string, RunOptions>(),
  results: new Map<string, (...args: unknown[]) => unknown>(),
};

let server: http.Server;
let base = "";
let context: ApiContext;
const protected_root = fs.mkdtempSync(path.join(os.tmpdir(), "vx-tmp-headless-data-"));

const stub_invoke = async (name: string, ...args: unknown[]) => {
  state.calls.push({ name, args });
  state.log.push(name);
  const result = state.results.get(name);
  if (!result) {
    throw new Error(`unexpected ${name}`);
  }
  return result(...args);
};

const reset = () => {
  state.calls.length = 0;
  state.log.length = 0;
  state.metas.clear();
  state.active.clear();
  state.pins.clear();
  state.results.clear();
  state.metas.set("chat-1", meta("chat-1"));
};

before(async () => {
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  context = {
    token,
    port,
    invoke: stub_invoke as ApiContext["invoke"],
    add_event_tap: () => () => {},
    session_meta: (id) => state.metas.get(id) ?? null,
    is_active: (id) => state.active.has(id),
    active_message: () => null,
    turn_settled: async () => {},
    ended_turn_settled: async () => {},
    chat_activity: () => ({ turn: false, agents: 0, workflows: 0, background: 0, queued: 0 }),
    chat_idle: () => true,
    when_idle: (chat_id, signal) =>
      once(signal, "abort").then(() => {
        throw new Error(`the idle wait of ${chat_id} was aborted`);
      }),
    pending_approvals: () => [],
    protected_dirs: [protected_root, path.join(protected_root, "..", "vx-tmp-headless-gui-app")],
    uploaded: (ids) => ids.map((id) => {
      if (id !== "att_known_1.txt") {
        throw new Error(`attachment ${id} is not available, attach the file again`);
      }
      return { id, kind: "file", name: "a.txt", mime: "text/plain", size: 1, vision_note: null };
    }),
    run_options: (id) => state.pins.get(id) ?? null,
    set_run_options: (id, options) => {
      state.log.push("set_run_options");
      state.pins.set(id, options);
    },
    forget_run_options: (id) => {
      state.pins.delete(id);
    },
    settings: () => ({ model: "vendor/b", effort: "high" }),
    model_catalog: async () => catalog,
    version: "9.9.9",
    headless: true,
    quit: () => {},
  };
  server.on("request", (request, response) => route(context, request, response));
});

after(async () => {
  await stop_runs(context);
  fs.rmSync(protected_root, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const send = (method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const error_code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

const raw_request = (headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const request = http.request(`${base}/v1/info`, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
    request.end();
  });

test("every API route matches its own path and method with decoded parameters", () => {
  for (const entry of api_routes) {
    const pathname = entry.path
      .split("/")
      .map((segment) => (segment.startsWith(":") ? encodeURIComponent(`${segment.slice(1)} x/y`) : segment))
      .join("/");
    const found = match(entry.method, pathname);
    assert.equal(found?.id, entry.id, entry.path);
    for (const [name, value] of Object.entries(found?.params ?? {})) {
      assert.equal(value, `${name} x/y`);
    }
  }
  assert.equal(match("PUT", "/v1/info"), null);
  assert.equal(match("GET", "/v1/info/"), null);
  assert.equal(match("GET", "/v1/sessions//questions"), null);
  assert.equal(match("GET", "/v2/info"), null);
  assert.throws(() => match("GET", "/v1/sessions/%E0%A4%A"), (error: unknown) => error instanceof RequestError && error.status === 400);
});

test("the handler table covers exactly the route table", () => {
  check_handlers(api_handlers);
  const missing = Object.fromEntries(Object.entries(api_handlers).filter(([id]) => id !== "info"));
  assert.throws(() => check_handlers(missing), /no handler for \[info\]/);
  assert.throws(() => check_handlers({ ...api_handlers, "sessions.rename": api_handlers.info }), /no route for \[sessions\.rename\]/);
});

test("the router refuses wrong hosts, origins and tokens before any handler runs", async () => {
  reset();
  assert.equal(await raw_request({ authorization: `Bearer ${token}`, host: "example.com" }), 421);
  assert.equal(await raw_request({ authorization: `Bearer ${token}`, origin: "http://127.0.0.1" }), 403);
  assert.equal(await raw_request({ authorization: "Bearer nope" }), 401);
  assert.equal(await raw_request({ authorization: `Bearer ${token}` }), 200);
  assert.equal((await send("GET", "/v1/nothing")).status, 404);
  assert.equal(await error_code(await send("DELETE", "/v1/info")), "not_found");
  assert.deepEqual(state.calls, []);
});

test("info reports the defaults and never the token", async () => {
  reset();
  const response = await send("GET", "/v1/info");
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { name: "VantheaX", version: "9.9.9", api: 1, headless: true, default_model: "vendor/b", default_mode: "auto", default_approvals: "reject" });
  assert.ok(!text.includes(token));
  assert.deepEqual(await (await send("GET", "/v1/models")).json(), [
    { id: "vendor/a", label: "VENDOR/A", efforts: ["low", "high"] },
    { id: "vendor/b", label: "VENDOR/B", efforts: ["low", "high"] },
  ]);
});

test("bad bodies are 400 invalid_request and never reach a handler channel", async () => {
  reset();
  const cases: [unknown, Record<string, string>][] = [
    ["{not json", {}],
    ["[1]", {}],
    [JSON.stringify({ text: "hi" }), { "content-type": "text/plain" }],
    [{ text: "" }, {}],
    [{ text: 5 }, {}],
    [{ text: "hi", plan: "yes" }, {}],
    [{ text: "hi", mode: "yolo" }, {}],
    [{ text: "hi", approvals: "always" }, {}],
    [{ text: "hi", attachment_ids: "a" }, {}],
    [{ text: "hi", attachment_ids: ["att_unknown_1.txt"] }, {}],
    [{ text: "hi", attachment_ids: ["att_known_1.txt", "att_known_1.txt"] }, {}],
  ];
  for (const [body, headers] of cases) {
    const response = await send("POST", "/v1/sessions/chat-1/prompt", body, headers);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(await error_code(response), "invalid_request");
  }
  const unknown = await send("POST", "/v1/sessions/chat-1/prompt", { text: "hi", model: "vendor/zzz" });
  assert.equal(unknown.status, 400);
  assert.equal(await error_code(unknown), "unknown_model");
  assert.deepEqual(state.calls, []);
});

test("every session route answers 404 for an unknown session", async () => {
  reset();
  for (const entry of api_routes.filter((item) => item.path.includes(":id"))) {
    const pathname = entry.path.replace(":id", "missing").replace(":run_id", "r1").replace(":approval_id", "m:c1_0");
    const response = await send(entry.method, pathname, entry.method === "POST" ? { text: "hi", message_id: "m", approved: true, answers: [{ id: "q", answer: "a" }] } : undefined);
    assert.equal(response.status, 404, entry.id);
    assert.equal(await error_code(response), "not_found");
  }
  assert.deepEqual(state.calls, []);
});

test("sessions.create needs an absolute existing directory and stores its options", async () => {
  reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vx-tmp-headless-api-"));
  try {
    const file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "x");
    for (const cwd of ["relative/dir", path.join(dir, "missing"), file, ""]) {
      assert.equal((await send("POST", "/v1/sessions", { cwd })).status, 400, cwd);
    }
    const inside = path.join(protected_root, "data", "v2");
    fs.mkdirSync(inside, { recursive: true });
    const junction = path.join(dir, "linked-data");
    fs.symlinkSync(inside, junction, "junction");
    for (const cwd of [protected_root, inside, protected_root.toUpperCase(), junction]) {
      const refused = await send("POST", "/v1/sessions", { cwd });
      assert.equal(refused.status, 400, cwd);
      assert.match(((await refused.json()) as { error: { message: string } }).error.message, /lies in the VantheaX data folder/);
    }
    state.results.set("chats:create", (cwd) => {
      const created = meta("chat-2", { project_path: String(cwd) });
      state.metas.set("chat-2", created);
      return created;
    });
    const response = await send("POST", "/v1/sessions", { cwd: dir.replaceAll("\\", "/"), mode: "full", approvals: "client", model: "vendor/a" });
    assert.equal(response.status, 200);
    assert.deepEqual(state.calls.map((entry) => entry.args), [[path.resolve(dir)]]);
    const options = await resolve_run_options(context, "chat-2", {});
    assert.deepEqual(options, { mode: "full", approvals: "client", choice: { model: "vendor/a", effort: "high", pro: false } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run options take the body over session options over the stored choice over settings", async () => {
  reset();
  assert.deepEqual(await resolve_run_options(context, "chat-1", {}), { mode: "auto", approvals: "reject", choice: { model: "vendor/b", effort: "high", pro: false } });
  state.metas.set("chat-1", meta("chat-1", { choice: { model: "vendor/a", effort: "low", pro: true } }));
  assert.deepEqual((await resolve_run_options(context, "chat-1", {})).choice, { model: "vendor/a", effort: "low", pro: true });
  assert.deepEqual((await resolve_run_options(context, "chat-1", { effort: "high" })).choice, { model: "vendor/a", effort: "high", pro: true });
  remember_session_options("chat-1", { model: "vendor/b", mode: "ask" });
  assert.deepEqual(await resolve_run_options(context, "chat-1", {}), { mode: "ask", approvals: "reject", choice: { model: "vendor/b", effort: "low", pro: false } });
  assert.deepEqual(await resolve_run_options(context, "chat-1", { model: "vendor/a-pro", mode: "full", approvals: "client" }), {
    mode: "full",
    approvals: "client",
    choice: { model: "vendor/a", effort: "low", pro: true },
  });
  remember_session_options("chat-1", {});
});

test("a prompt pins its options before turn:send and answers 202 with the run id", async () => {
  reset();
  state.results.set("turn:send", () => ({ user_message_id: "u1", message_id: "m1" }));
  const response = await send("POST", "/v1/sessions/chat-1/prompt", { text: "fix it", mode: "full", effort: "low", plan: true, attachment_ids: ["att_known_1.txt"] });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { run_id: "m1", user_message_id: "u1", message_id: "m1" });
  assert.deepEqual(state.log, ["set_run_options", "turn:send"]);
  assert.deepEqual(state.calls[0].args, [
    { chat_id: "chat-1", text: "fix it", attachment_ids: ["att_known_1.txt"], model: "vendor/b", effort: "low", pro: false, mode: "full", plan: true, origin: "user" },
  ]);
  assert.deepEqual(state.pins.get("chat-1"), { mode: "full", approvals: "reject", choice: { model: "vendor/b", effort: "low", pro: false } });
});

test("a prompt on a busy session is 409 and keeps the pinned options of the running turn", async () => {
  reset();
  const running: RunOptions = { mode: "ask", approvals: "client", choice: { model: "vendor/a", effort: "low", pro: false } };
  state.pins.set("chat-1", running);
  state.active.add("chat-1");
  const busy = await send("POST", "/v1/sessions/chat-1/prompt", { text: "again" });
  assert.equal(busy.status, 409);
  assert.equal(await error_code(busy), "session_busy");
  assert.deepEqual(state.calls, []);
  state.active.clear();
  state.results.set("turn:send", () => {
    state.active.add("chat-1");
    throw new Error("chat chat-1 already has a running turn");
  });
  const raced = await send("POST", "/v1/sessions/chat-1/prompt", { text: "again", mode: "full" });
  assert.equal(raced.status, 409);
  assert.deepEqual(state.pins.get("chat-1"), running);
  state.active.clear();
  state.results.set("turn:send", () => {
    throw new Error("model vendor/b is not in the catalog");
  });
  const failed = await send("POST", "/v1/sessions/chat-1/prompt", { text: "again" });
  assert.equal(failed.status, 500);
  assert.equal(await error_code(failed), "internal");
  assert.deepEqual(state.pins.get("chat-1"), running);
});

test("steer without a running turn and approvals that are not pending are 404", async () => {
  reset();
  state.results.set("turn:steer", () => null);
  state.results.set("agents:approvals", (chat_id) => ({ chat_id, approvals: [] }));
  assert.equal((await send("POST", "/v1/sessions/chat-1/steer", { text: "also this" })).status, 404);
  assert.equal(typeof state.calls[0].args[3], "string");
  for (const approval_id of ["m:c1_0", "a:agent_x:run_y:c1_0", "bogus"]) {
    assert.equal((await send("POST", `/v1/sessions/chat-1/approvals/${encodeURIComponent(approval_id)}`, { approved: true })).status, 404, approval_id);
    assert.equal((await send("POST", `/v1/sessions/chat-1/approvals/${encodeURIComponent(approval_id)}/hold`)).status, 404, approval_id);
  }
  assert.ok(!state.calls.some((entry) => entry.name === "turn:approve" || entry.name === "agents:approve"));
});

const fake_request = (chunks: Buffer[], headers: Record<string, string>) => Object.assign(Readable.from(chunks), { headers }) as unknown as http.IncomingMessage;

test("bodies are capped and parsed at the boundary", async () => {
  const chunk = Buffer.alloc(64 * 1024, 97);
  const many = Array.from({ length: json_limit / chunk.length + 1 }, () => chunk);
  await assert.rejects(read_raw(fake_request(many, {}), json_limit), (error: unknown) => error instanceof RequestError && error.status === 413);
  await assert.rejects(read_raw(fake_request([], { "content-length": String(json_limit + 1) }), json_limit), (error: unknown) => error instanceof RequestError && error.code === "payload_too_large");
  assert.equal((await read_raw(fake_request([chunk, chunk], {}), json_limit)).length, chunk.length * 2);
  assert.deepEqual(await read_json(fake_request([Buffer.from('{"a":1}')], { "content-type": "application/json; charset=utf-8" })), { a: 1 });
  await assert.rejects(read_json(fake_request([Buffer.from("{}")], {})), (error: unknown) => error instanceof RequestError && error.status === 400);
});

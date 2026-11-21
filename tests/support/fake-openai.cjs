const crypto = require("node:crypto");
const http = require("node:http");
const zlib = require("node:zlib");

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const registration_client_id = "dynamic_agent_client";
const agent_name = "VantheaX";
const tool_call_id = "call_smoke_1";
const key_id = "smoke-key-1";

const account = { sub: "user-smoke-1", email: "smoke@example.invalid", name: "Smoke User" };

const answers = {
  tool: "Smoke answer: the ChatGPT plan listed its models.",
  text: "Smoke answer from the ChatGPT plan.",
  limit: "The smoke test scripted the ChatGPT usage limit.",
};

const account_models = [
  { slug: "gpt-6.2-sol", display_name: "GPT-6.2 Sol", visibility: "list", context_window: 272000, supported_in_api: true },
  { slug: "gpt-6.2-astra", display_name: "GPT-6.2 Astra", visibility: "hide", context_window: 272000, supported_in_api: true },
  { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list", context_window: 400000, supported_in_api: true },
  { slug: "gpt-smoke-unlisted", display_name: "Smoke Only", visibility: "list", context_window: 128000, supported_in_api: true },
];

const scenarios = ["SMOKE_PLAN_TOOL", "SMOKE_LIMIT"];

const base64url = (value) => Buffer.from(value).toString("base64url");

const send_json = (response, status, value, headers = {}) => {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers });
  response.end(body);
};

const read_body = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const text_of = (content) => {
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content) ? content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n") : "";
};

const authorize_problems = (query, known_clients) => {
  const problems = [];
  const client_id = query.get("client_id") ?? "";
  if (client_id === registration_client_id) {
    if (query.get("agent_name_hint") !== agent_name) {
      problems.push(`agent_name_hint is ${query.get("agent_name_hint")}, expected ${agent_name}`);
    }
  } else if (!known_clients.has(client_id)) {
    problems.push(`client_id ${client_id} is neither ${registration_client_id} nor an issued client id`);
  } else if (query.has("agent_name_hint")) {
    problems.push("agent_name_hint is sent with an issued client id");
  }
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(query.get("ext_agent_host_id") ?? "")) {
    problems.push(`ext_agent_host_id ${query.get("ext_agent_host_id")} is not a urn:uuid`);
  }
  let redirect = null;
  try {
    redirect = new URL(query.get("redirect_uri") ?? "");
  } catch (error) {
    problems.push(`redirect_uri is not a URL: ${error.message}`);
  }
  if (redirect && (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.pathname !== "/auth/callback" || !redirect.port)) {
    problems.push(`redirect_uri ${redirect.href} is not http://127.0.0.1:<port>/auth/callback`);
  }
  const expected = { response_type: "code", scope, resource, code_challenge_method: "S256" };
  for (const [name, value] of Object.entries(expected)) {
    if (query.get(name) !== value) {
      problems.push(`${name} is ${query.get(name)}, expected ${value}`);
    }
  }
  for (const name of ["state", "nonce"]) {
    if (!query.get(name)) {
      problems.push(`${name} is missing`);
    }
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(query.get("code_challenge") ?? "")) {
    problems.push("code_challenge is not a base64url SHA-256 digest");
  }
  for (const name of ["id_token_hint", "force_reconsent", "client_secret"]) {
    if (query.has(name)) {
      problems.push(`${name} must not be sent`);
    }
  }
  return problems;
};

const create_state = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    private_key: privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid: key_id, alg: "RS256", use: "sig" },
    clients: new Set(),
    codes: new Map(),
    access_tokens: [],
    refresh_tokens: new Map(),
    revoked: [],
    counter: 0,
  };
};

const id_token = (state, client_id, nonce) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", kid: key_id, typ: "JWT" }));
  const claims = { iss: issuer, aud: [client_id], sub: account.sub, email: account.email, name: account.name, iat: now, exp: now + 3600, ...(nonce ? { nonce } : {}) };
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), state.private_key).toString("base64url");
  return `${header}.${payload}.${signature}`;
};

const issue_tokens = (state, client_id, nonce) => {
  state.counter += 1;
  const access_token = `smoke-access-${state.counter}`;
  const refresh_token = `smoke-refresh-${state.counter}`;
  state.access_tokens.push(access_token);
  state.refresh_tokens.set(client_id, refresh_token);
  return {
    access_token,
    refresh_token,
    ...(nonce === undefined ? {} : { id_token: id_token(state, client_id, nonce) }),
    token_type: "Bearer",
    expires_in: 3600,
    scope,
  };
};

const authorize = (state, url, entry, response) => {
  const query = url.searchParams;
  entry.problems = authorize_problems(query, state.clients);
  if (entry.problems.length) {
    send_json(response, 400, { error: "invalid_request", error_description: entry.problems.join("; ") });
    return;
  }
  const requested = query.get("client_id");
  const client_id = requested === registration_client_id ? `oaiapp_smoke_${state.clients.size + 1}` : requested;
  state.clients.add(client_id);
  const code = `smoke-code-${crypto.randomBytes(12).toString("hex")}`;
  state.codes.set(code, { client_id, nonce: query.get("nonce"), challenge: query.get("code_challenge"), redirect_uri: query.get("redirect_uri") });
  const target = new URL(query.get("redirect_uri"));
  target.search = new URLSearchParams({ code, state: query.get("state"), client_id, scope }).toString();
  response.writeHead(302, { Location: target.href, "Content-Length": 0 });
  response.end();
};

const token = (state, form, entry, response) => {
  const grant = form.get("grant_type");
  const fail = (code, description) => {
    entry.problems.push(description);
    send_json(response, 400, { error: code, error_description: description });
  };
  if (form.get("resource") !== resource) {
    return fail("invalid_request", `resource is ${form.get("resource")}, expected ${resource}`);
  }
  if (form.has("client_secret") || form.has("scope")) {
    return fail("invalid_request", "client_secret and scope must not be sent to the token endpoint");
  }
  if (grant === "authorization_code") {
    const issued = state.codes.get(form.get("code") ?? "");
    state.codes.delete(form.get("code") ?? "");
    if (!issued) {
      return fail("invalid_grant", "the authorization code is unknown or used");
    }
    if (form.get("client_id") !== issued.client_id || form.get("redirect_uri") !== issued.redirect_uri) {
      return fail("invalid_grant", "client_id or redirect_uri differ from the authorization request");
    }
    const digest = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    if (digest !== issued.challenge) {
      return fail("invalid_grant", "the code_verifier does not match the code_challenge");
    }
    return send_json(response, 200, issue_tokens(state, issued.client_id, issued.nonce), { "x-request-id": `req_token_${entry.index}` });
  }
  if (grant === "refresh_token") {
    const client_id = form.get("client_id") ?? "";
    if (!state.refresh_tokens.has(client_id) || state.refresh_tokens.get(client_id) !== form.get("refresh_token")) {
      return fail("invalid_grant", "the refresh token is unknown, rotated or revoked");
    }
    return send_json(response, 200, issue_tokens(state, client_id, undefined));
  }
  return fail("unsupported_grant_type", `grant_type ${grant} is not supported`);
};

const revoke = (state, form, entry, response) => {
  const client_id = form.get("client_id") ?? "";
  const refresh_token = form.get("token") ?? "";
  if (form.get("token_type_hint") !== "refresh_token" || !state.clients.has(client_id)) {
    entry.problems.push("the revocation names no refresh_token hint or an unknown client id");
  }
  state.revoked.push({ client_id, token: refresh_token });
  if (state.refresh_tokens.get(client_id) === refresh_token) {
    state.refresh_tokens.delete(client_id);
  }
  response.writeHead(200, { "Content-Length": 0 });
  response.end();
};

const bearer_valid = (state, request) => {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") && state.access_tokens.includes(header.slice("Bearer ".length));
};

const scenario_of = (input) => {
  for (let at = input.length - 1; at >= 0; at -= 1) {
    const item = input[at];
    if (item?.type !== "message" || item.role !== "user") {
      continue;
    }
    const text = text_of(item.content);
    const name = scenarios.find((key) => text.includes(key));
    if (name) {
      return { name, round: input.slice(at + 1).filter((entry) => entry?.type === "function_call_output").length };
    }
  }
  return null;
};

const side_text = (body, input) => {
  const developer = text_of(input.find((item) => item?.role === "developer")?.content);
  if (developer.includes("decision: allow, review or deny")) {
    return JSON.stringify({ rule_source: "none", rule: "", workaround_of: "", script_summary: "", reason: "The smoke test decides this step.", decision: "allow" });
  }
  if (developer.includes("You name chat threads")) {
    return "Smoke plan session";
  }
  if (developer.includes("live status line")) {
    return "Working on the plan smoke test";
  }
  return body.text?.format ? "[]" : answers.text;
};

const usage_of = (input, output) => {
  const input_tokens = Math.max(1, Math.round(JSON.stringify(input).length / 4));
  const output_tokens = Math.max(1, Math.round(JSON.stringify(output).length / 4));
  return { input_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens, output_tokens_details: { reasoning_tokens: 3 }, total_tokens: input_tokens + output_tokens };
};

const split_text = (text, size) => {
  const pieces = [];
  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }
  return pieces;
};

const tool_round = () => {
  const summary = "Listing the plan models.";
  const reasoning = { type: "reasoning", id: "rs_smoke_1", summary: [{ type: "summary_text", text: summary }], encrypted_content: "enc_smoke_1" };
  const call = { type: "function_call", id: "fc_smoke_1", call_id: tool_call_id, name: "list_models", arguments: "{}", status: "completed" };
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: reasoning.id, summary: [] } },
    { type: "response.reasoning_summary_part.added", item_id: reasoning.id, output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } },
    { type: "response.reasoning_summary_text.delta", item_id: reasoning.id, output_index: 0, summary_index: 0, delta: summary },
    { type: "response.reasoning_summary_text.done", item_id: reasoning.id, output_index: 0, summary_index: 0, text: summary },
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    { type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "", status: "in_progress" } },
    { type: "response.function_call_arguments.delta", item_id: call.id, output_index: 1, delta: "{}" },
    { type: "response.function_call_arguments.done", item_id: call.id, output_index: 1, arguments: "{}" },
    { type: "response.output_item.done", output_index: 1, item: call },
  ];
  return { output: [reasoning, call], events };
};

const text_round = (index, text) => {
  const id = `msg_smoke_${index}`;
  const part = { type: "output_text", text, annotations: [] };
  const done = { type: "message", id, role: "assistant", status: "completed", phase: "final_answer", content: [part] };
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { ...done, status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: id, output_index: 0, content_index: 0, part: { ...part, text: "" } },
    ...split_text(text, 9).map((delta) => ({ type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta })),
    { type: "response.output_text.done", item_id: id, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: id, output_index: 0, content_index: 0, part },
    { type: "response.output_item.done", output_index: 0, item: done },
  ];
  return { output: [done], events };
};

const write_events = (response, entry, events) => {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "x-request-id": `req_smoke_${entry.index}` });
  response.write(": smoke responses stream\n\n");
  events.forEach((event, sequence_number) => response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`));
  response.end();
};

const responses = (state, request, raw, entry, response) => {
  if (!bearer_valid(state, request)) {
    entry.problems.push("the bearer is not an access token this fake issued");
    send_json(response, 401, { error: { message: "The access token is not valid.", type: "invalid_request_error", code: "invalid_token", param: null } });
    return;
  }
  const decoded = request.headers["content-encoding"] === "zstd" ? zlib.zstdDecompressSync(raw) : raw;
  const body = JSON.parse(decoded.toString("utf8"));
  const input = Array.isArray(body.input) ? body.input : [];
  const found = scenario_of(input);
  Object.assign(entry, { body, kind: input.some((item) => item?.type === "additional_tools") ? "round" : "side", scenario: found?.name ?? null, round: found?.round ?? null });
  if (entry.scenario === "SMOKE_LIMIT") {
    send_json(response, 429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: answers.limit, type: "usage_limit", param: null } });
    return;
  }
  const round_text = entry.scenario === "SMOKE_PLAN_TOOL" ? answers.tool : answers.text;
  const script = entry.kind === "round" && entry.scenario === "SMOKE_PLAN_TOOL" && entry.round === 0 ? tool_round() : text_round(entry.index, entry.kind === "round" ? round_text : side_text(body, input));
  const id = `resp_smoke_${entry.index}`;
  write_events(response, entry, [
    { type: "response.created", response: { id, status: "in_progress", output: [] } },
    ...script.events,
    { type: "response.completed", response: { id, status: "completed", output: script.output, usage: usage_of(input, script.output) } },
  ]);
};

const read_form = (request, raw, entry) => {
  if ((request.headers["content-type"] ?? "").split(";")[0] !== "application/x-www-form-urlencoded") {
    entry.problems.push(`the content type is ${request.headers["content-type"]}, expected application/x-www-form-urlencoded`);
  }
  const form = new URLSearchParams(raw.toString("utf8"));
  entry.form = Object.fromEntries(form);
  return form;
};

const handle = async (state, requests, request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const raw = await read_body(request);
  const entry = { index: requests.length + 1, at: Date.now(), method: request.method, route: url.pathname, query: Object.fromEntries(url.searchParams), authorization: request.headers.authorization ?? null, form: null, body: null, kind: "other", scenario: null, round: null, problems: [] };
  requests.push(entry);
  const key = `${request.method} ${url.pathname}`;
  if (key === "GET /api/accounts/authorize") {
    return authorize(state, url, entry, response);
  }
  if (key === "POST /api/accounts/oauth/token") {
    return token(state, read_form(request, raw, entry), entry, response);
  }
  if (key === "POST /api/accounts/oauth/revoke") {
    return revoke(state, read_form(request, raw, entry), entry, response);
  }
  if (key === "GET /.well-known/jwks.json") {
    return send_json(response, 200, { keys: [state.jwk] });
  }
  if (key === "GET /v1/models") {
    return bearer_valid(state, request) ? send_json(response, 200, { models: account_models }) : send_json(response, 401, { error: "invalid_token", error_description: "unknown access token" });
  }
  if (key === "POST /v1/responses") {
    return responses(state, request, raw, entry, response);
  }
  entry.problems.push(`no route ${key}`);
  return send_json(response, 404, { detail: `the fake OpenAI server has no route ${key}` });
};

const start_fake_openai = () =>
  new Promise((resolve, reject) => {
    const requests = [];
    const state = create_state();
    const server = http.createServer((request, response) => {
      handle(state, requests, request, response).catch((error) => {
        console.error(`[fake-openai] ${request.method} ${request.url.split("?")[0]} failed:`, error);
        if (!response.headersSent) {
          send_json(response, 500, { detail: String(error && error.message) });
        } else {
          response.destroy();
        }
      });
    });
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const { port } = server.address();
      const close = () =>
        new Promise((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
      resolve({ url: `http://127.0.0.1:${port}`, requests, state, close });
    });
  });

module.exports = { start_fake_openai, answers, account, scope, tool_call_id };

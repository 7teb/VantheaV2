const http = require("node:http");

const answers = {
  text: "Smoke answer: the headless run works.",
  tool: "Smoke answer: the run went on without the rejected command.",
  error: "The smoke test scripted this provider error.",
};

const approval_command = "Set-Content -Path smoke-approval.txt -Value rejected";

const scenarios = {
  SMOKE_TEXT: [{ text: answers.text }],
  SMOKE_TOOL: [{ tools: [{ name: "run_command", args: { command: approval_command } }] }, { text: answers.tool }],
  SMOKE_ERROR: "error",
};

const text_of = (content) => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n");
  }
  return "";
};

const split_text = (text, size) => {
  const pieces = [];
  for (let start = 0; start < text.length; start += size) {
    pieces.push(text.slice(start, start + size));
  }
  return pieces;
};

const usage_for = (messages, output) => {
  const prompt_tokens = Math.max(1, Math.round(JSON.stringify(messages).length / 4));
  const completion_tokens = Math.max(1, Math.round(output.length / 4));
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 3 },
  };
};

const find_scenario = (messages) => {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at].role !== "user") {
      continue;
    }
    const text = text_of(messages[at].content);
    const name = Object.keys(scenarios).find((key) => text.includes(key));
    if (name) {
      const round = messages.slice(at + 1).filter((message) => message.role === "assistant").length;
      return { name, round };
    }
  }
  return null;
};

const side_text = (messages) => {
  const system = text_of(messages.find((message) => message.role === "system")?.content);
  if (system.includes("decision: allow, review or deny")) {
    const decision = JSON.stringify(messages).includes("smoke-approval") ? "review" : "allow";
    return JSON.stringify({ rule_source: "none", rule: "", workaround_of: "", script_summary: "", reason: "The smoke test decides this step.", decision });
  }
  if (system.includes("You name chat threads")) {
    return "Smoke session";
  }
  if (system.includes("live status line")) {
    return "Working on the smoke test";
  }
  return "[]";
};

const send_json = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
};

const read_body = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const stream_round = (response, round, messages, id) => {
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish_reason = null) => ({ id, object: "chat.completion.chunk", created, model: "fake/smoke", choices: [{ index: 0, delta, finish_reason }] });
  const frames = [];
  (round.tools || []).forEach((tool, index) => {
    const call = { index, id: `call_smoke_${id}_${index}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } };
    frames.push(chunk({ role: "assistant", tool_calls: [call] }));
  });
  for (const piece of split_text(round.text || "", 9)) {
    frames.push(chunk({ role: "assistant", content: piece }));
  }
  const output = `${round.text || ""}${(round.tools || []).map((tool) => JSON.stringify(tool.args)).join("")}`;
  frames.push(chunk({}, round.tools && round.tools.length ? "tool_calls" : "stop"));
  frames.push({ id, object: "chat.completion.chunk", created, model: "fake/smoke", choices: [], usage: usage_for(messages, output) });
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  response.write(": smoke stream open\n\n");
  for (const frame of frames) {
    response.write(`data: ${JSON.stringify(frame)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
};

const fallback_round = { text: "Smoke answer for a prompt without a scenario marker." };

const completions = (response, request_body, entry) => {
  const messages = Array.isArray(request_body.messages) ? request_body.messages : [];
  const id = `gen-smoke-${entry.index}`;
  if (!request_body.stream) {
    const content = side_text(messages);
    entry.kind = "side";
    send_json(response, 200, {
      id,
      object: "chat.completion",
      model: "fake/smoke",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: usage_for(messages, content),
    });
    return;
  }
  const found = find_scenario(messages);
  entry.kind = "round";
  entry.scenario = found ? found.name : null;
  entry.round = found ? found.round : 0;
  const script = found ? scenarios[found.name] : [fallback_round];
  if (script === "error") {
    send_json(response, 400, { error: { code: 400, message: answers.error } });
    return;
  }
  stream_round(response, script[Math.min(entry.round, script.length - 1)], messages, id);
};

const handle = async (request, response, requests) => {
  const route = new URL(request.url, "http://127.0.0.1").pathname.replace(/^\/api\/v1/, "");
  const text = await read_body(request);
  const entry = { index: requests.length + 1, at: Date.now(), method: request.method, route, kind: "other", scenario: null, round: null, messages: null };
  requests.push(entry);
  if (route === "/key") {
    send_json(response, 200, { data: { limit: null, usage: 0 } });
    return;
  }
  if (route === "/images/models") {
    send_json(response, 200, { data: [] });
    return;
  }
  if (/^\/models\/.+\/endpoints$/.test(route)) {
    send_json(response, 200, { data: { endpoints: [] } });
    return;
  }
  if (route !== "/chat/completions" || request.method !== "POST") {
    send_json(response, 404, { error: { code: 404, message: `the fake OpenRouter has no route ${request.method} ${route}` } });
    return;
  }
  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch (error) {
    send_json(response, 400, { error: { code: 400, message: `the request body is not JSON: ${error.message}` } });
    return;
  }
  entry.messages = Array.isArray(body.messages) ? body.messages : [];
  completions(response, body, entry);
};

const start_fake_openrouter = () =>
  new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((request, response) => {
      handle(request, response, requests).catch((error) => {
        console.error(`[fake-openrouter] ${request.method} ${request.url} failed:`, error);
        if (!response.headersSent) {
          send_json(response, 500, { error: { code: 500, message: String(error && error.message) } });
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
      resolve({ url: `http://127.0.0.1:${port}`, requests, close });
    });
  });

module.exports = { start_fake_openrouter, answers, approval_command };

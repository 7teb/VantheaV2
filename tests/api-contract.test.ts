import assert from "node:assert/strict";
import { test } from "node:test";
import { agent_approval_id, main_approval_id, parse_approval_id } from "../shared/api/approval-id.ts";
import { api_version, type ApiEvent } from "../shared/api/contract.ts";
import { api_event_types, api_routes, event_names, route_path } from "../shared/api/routes.ts";
import { channel_kind } from "../shared/ipc/index.ts";

const every_event_type: Record<ApiEvent["type"], true> = {
  hello: true,
  ping: true,
  resync: true,
  "turn.event": true,
  "session.appended": true,
  "session.updated": true,
  "session.deleted": true,
  "questions.changed": true,
  "agent.event": true,
  "agents.changed": true,
  "agent.approvals_changed": true,
  "background.changed": true,
  "account.changed": true,
  "run.settled": true,
};

test("the API version is 1", () => {
  assert.equal(api_version, 1);
});

test("route ids and method plus path pairs are unique", () => {
  const ids = api_routes.map((route) => route.id);
  assert.equal(new Set(ids).size, ids.length);
  const pairs = api_routes.map((route) => `${route.method} ${route.path}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

test("every route lives under /v1 and has a summary", () => {
  for (const route of api_routes) {
    assert.ok(route.path.startsWith("/v1/"), route.id);
    assert.ok(route.summary.trim().length > 0, route.id);
    assert.ok(["GET", "POST", "DELETE"].includes(route.method), route.id);
  }
});

test("the route table covers exactly the endpoints of the contract", () => {
  assert.deepEqual(
    api_routes.map((route) => route.id),
    [
      "info",
      "models",
      "account.get",
      "account.billing",
      "account.sign_in",
      "account.sign_out",
      "sessions.list",
      "sessions.create",
      "sessions.get",
      "sessions.remove",
      "prompt",
      "run.get",
      "stop",
      "steer",
      "approvals.list",
      "approvals.reply",
      "approvals.hold",
      "questions.list",
      "questions.reply",
      "plan.accept",
      "diff",
      "attachments.upload",
      "events",
      "shutdown",
    ],
  );
});

test("route_path fills and URI-encodes path parameters", () => {
  assert.equal(route_path("info", {}), "/v1/info");
  assert.equal(route_path("account.sign_in", {}), "/v1/account/chatgpt/sign_in");
  assert.equal(route_path("sessions.get", { id: "chat_1" }), "/v1/sessions/chat_1");
  assert.equal(route_path("sessions.get", { id: "a b/c?d" }), "/v1/sessions/a%20b%2Fc%3Fd");
  assert.equal(route_path("run.get", { id: "s1", run_id: "m 2" }), "/v1/sessions/s1/runs/m%202");
  assert.equal(
    route_path("approvals.hold", { id: "s1", approval_id: agent_approval_id("agent_x", "run_y", "c0_1") }),
    "/v1/sessions/s1/approvals/a%3Aagent_x%3Arun_y%3Ac0_1/hold",
  );
});

test("the public event list is pinned and every mapped IPC event is a known API event", () => {
  assert.deepEqual([...api_event_types].sort(), Object.keys(every_event_type).sort());
  assert.equal(new Set(api_event_types).size, api_event_types.length);
  const known = new Set<string>(api_event_types);
  for (const [ipc_name, api_name] of Object.entries(event_names)) {
    assert.ok(known.has(api_name), `${ipc_name} -> ${api_name}`);
  }
  assert.equal(new Set(Object.values(event_names)).size, Object.values(event_names).length);
});

test("every mapped IPC name is a declared event channel", () => {
  for (const ipc_name of Object.keys(event_names)) {
    assert.equal(channel_kind(ipc_name), "event", ipc_name);
  }
});

test("the ChatGPT account change is published as account.changed and the account routes sit under /v1/account", () => {
  assert.equal(event_names["chatgpt:changed"], "account.changed");
  const account = api_routes.filter((route) => route.id.startsWith("account."));
  assert.deepEqual(
    account.map((route) => `${route.method} ${route.path}`),
    ["GET /v1/account", "POST /v1/account/billing", "POST /v1/account/chatgpt/sign_in", "POST /v1/account/chatgpt/sign_out"],
  );
});

test("main approval ids round trip", () => {
  const id = main_approval_id("c3_0");
  assert.equal(id, "m:c3_0");
  assert.deepEqual(parse_approval_id(id), { source: "main", call_id: "c3_0" });
});

test("agent approval ids round trip and keep colons inside the call id", () => {
  const id = agent_approval_id("agent_1", "run_2", "c1_4");
  assert.equal(id, "a:agent_1:run_2:c1_4");
  assert.deepEqual(parse_approval_id(id), { source: "agent", agent_id: "agent_1", run_id: "run_2", call_id: "c1_4" });
  assert.deepEqual(parse_approval_id(agent_approval_id("agent_1", "run_2", "x:y")), {
    source: "agent",
    agent_id: "agent_1",
    run_id: "run_2",
    call_id: "x:y",
  });
  assert.deepEqual(parse_approval_id(main_approval_id("x:y")), { source: "main", call_id: "x:y" });
});

test("malformed approval ids parse to null", () => {
  for (const id of ["", "m:", "a:", "a:agent_1", "a:agent_1:run_2", "a:agent_1:run_2:", "a::run_2:c0", "x:c0", "c0_1"]) {
    assert.equal(parse_approval_id(id), null, id);
  }
});

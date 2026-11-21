import assert from "node:assert/strict";
import { test } from "node:test";
import { plan_error, read_plan_error, type PlanErrorBody } from "../electron/model/plan/errors.ts";

const context = { retry_after_ms: 7000, request_id: "", token: "plan-secret-token" };

const body = (code: string, message = "detail", param = ""): PlanErrorBody => ({ code, message, param, type: "" });

const kind_of = (status: number | null, value: PlanErrorBody | null) => plan_error(status, value, context).kind;

test("error bodies are read in every documented shape", () => {
  assert.equal(read_plan_error(""), null);
  assert.equal(read_plan_error("   "), null);
  assert.deepEqual(read_plan_error('{"detail":"Unsupported parameter: max_output_tokens"}'), body("", "Unsupported parameter: max_output_tokens"));
  assert.deepEqual(read_plan_error('{"detail":[{"loc":["body","input"],"type":"missing"}]}'), body("", '[{"loc":["body","input"],"type":"missing"}]'));
  assert.deepEqual(read_plan_error('{"error":{"message":"limit","type":"usage","param":null,"code":"subscription_sharing_usage_limit_exceeded"}}'), {
    code: "subscription_sharing_usage_limit_exceeded",
    message: "limit",
    param: "",
    type: "usage",
  });
  assert.deepEqual(read_plan_error('{"message":"no model","type":"invalid_request_error","param":"model","code":"model_not_found"}'), {
    code: "model_not_found",
    message: "no model",
    param: "model",
    type: "invalid_request_error",
  });
  assert.deepEqual(read_plan_error('{"error":"invalid_token","error_description":"expired"}'), body("invalid_token", "expired"));
  assert.deepEqual(read_plan_error("<html>bad gateway</html>"), body("", "<html>bad gateway</html>"));
  assert.deepEqual(read_plan_error('{"unexpected":true}'), body("", '{"unexpected":true}'));
});

test("usage limits are plan_limit with or without a status, also under the legacy prefix", () => {
  assert.equal(kind_of(429, body("subscription_sharing_usage_limit_exceeded")), "plan_limit");
  assert.equal(kind_of(null, body("subscription_sharing_usage_limit_exceeded")), "plan_limit");
  assert.equal(kind_of(429, body("subscription_sharing_v2_usage_limit_exceeded")), "plan_limit");
  assert.equal(kind_of(429, body("subscription_sharing_workplace_individual_usage_limit_exceeded")), "plan_limit");
  assert.equal(plan_error(429, body("subscription_sharing_usage_limit_exceeded"), context).retry_after_ms, 0);
});

test("context overflow uses the shared sentence", () => {
  const coded = plan_error(400, body("context_length_exceeded", "too long"), context);
  assert.equal(coded.kind, "context_limit");
  assert.match(coded.message, /^The conversation is larger than the model's context window\. Compact the chat or start a new one\. \(ChatGPT plan 400: too long/);
  assert.equal(kind_of(400, body("", "Your input exceeds the context window of this model")), "context_limit");
});

test("model, auth, blocked, unavailable, rate and policy codes map before the status", () => {
  assert.equal(kind_of(404, body("model_not_found")), "plan_model");
  assert.equal(kind_of(400, body("subscription_sharing_unsupported_capability", "bad", "model")), "plan_model");
  for (const code of ["subscription_sharing_invalid_user", "invalid_token", "invalid_api_key"]) {
    assert.equal(kind_of(400, body(code)), "plan_auth", code);
  }
  for (const code of [
    "subscription_sharing_user_not_eligible",
    "subscription_sharing_route_not_supported",
    "chatpass_v2_scope_not_authorized",
    "chatpass_v2_invalid_authorization_context",
    "subscription_sharing_client_not_enabled",
    "subscription_sharing_v2_client_not_enabled",
  ]) {
    assert.equal(kind_of(400, body(code)), "plan_blocked", code);
  }
  for (const code of ["subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable", "server_error"]) {
    assert.equal(kind_of(400, body(code)), "provider_unavailable", code);
  }
  assert.equal(kind_of(400, body("rate_limit_exceeded")), "rate_limited");
  assert.equal(kind_of(400, body("content_policy_violation")), "policy");
  assert.equal(kind_of(400, body("cyber_policy")), "policy");
  const unsupported = plan_error(400, body("subscription_sharing_unsupported_capability", "Unsupported tool", "tools[0]"), context);
  assert.equal(unsupported.kind, "bad_request");
  assert.equal(unsupported.message, "ChatGPT plan 400: Unsupported tool (subscription_sharing_unsupported_capability, parameter tools[0])");
});

test("without a known code the status decides", () => {
  assert.equal(kind_of(401, body("", "Unauthorized")), "plan_auth");
  assert.equal(kind_of(403, body("", "region")), "plan_blocked");
  assert.equal(kind_of(429, null), "rate_limited");
  assert.equal(kind_of(408, null), "timeout");
  assert.equal(kind_of(504, null), "timeout");
  assert.equal(kind_of(500, null), "provider_unavailable");
  assert.equal(kind_of(503, body("", "direct routing unavailable")), "provider_unavailable");
  assert.equal(kind_of(400, body("", "Unsupported parameter: temperature")), "bad_request");
  assert.equal(kind_of(422, null), "bad_request");
  assert.equal(kind_of(null, body("weird_code")), "bad_request");
  assert.equal(kind_of(null, null), "bad_request");
});

test("the message names the status, detail and request id, redacts the token and is cut", () => {
  const error = plan_error(401, body("invalid_token", "token plan-secret-token is expired"), { ...context, request_id: "req_42" });
  assert.equal(error.message, "ChatGPT plan 401: token [redacted] is expired (invalid_token) (request req_42)");
  assert.equal(error.status, 401);
  assert.equal(plan_error(null, null, context).message, "ChatGPT plan: no detail returned");
  const long = plan_error(400, body("", "x".repeat(3000)), context);
  assert.equal(long.message.length, 1200);
});

test("retry_after is kept only for rate limits and unavailable answers", () => {
  assert.equal(plan_error(429, null, context).retry_after_ms, 7000);
  assert.equal(plan_error(503, null, context).retry_after_ms, 7000);
  assert.equal(plan_error(400, null, context).retry_after_ms, 0);
  assert.equal(plan_error(401, null, context).retry_after_ms, 0);
});

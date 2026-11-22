import assert from "node:assert/strict";
import { test } from "node:test";
import { account_lines, follow_sign_in, run_account } from "../sdk/cli-account.ts";
import { VantheaxError } from "../sdk/http.ts";
import type { AccountInfo } from "../shared/api/contract.ts";
import { account_info, json_body, result_of, start_stub, type Reply } from "./sdk-client-kit.ts";

test("client methods use the method, path, body and bearer of the route table", async () => {
  const { stub, client, close } = await start_stub();
  const started = { run_id: "m1", user_message_id: "u1", message_id: "m1" };
  const replies: [string, Reply][] = [
    ["GET /v1/info", { status: 200, body: { name: "VantheaX", api: 1 } }],
    ["GET /v1/models", { status: 200, body: [{ id: "a/b", label: "B", efforts: ["low"] }] }],
    ["POST /v1/sessions", { status: 200, body: { id: "s 1" } }],
    ["GET /v1/sessions", { status: 200, body: [] }],
    ["GET /v1/sessions/s%201", { status: 200, body: { id: "s 1", messages: [] } }],
    ["DELETE /v1/sessions/s%201", { status: 204 }],
    ["POST /v1/sessions/s%201/prompt", { status: 202, body: started }],
    ["GET /v1/sessions/s%201/runs/m1", { status: 200, body: result_of("m1", "done") }],
    ["POST /v1/sessions/s%201/stop", { status: 204 }],
    ["POST /v1/sessions/s%201/steer", { status: 204 }],
    ["GET /v1/sessions/s%201/approvals", { status: 200, body: [] }],
    ["POST /v1/sessions/s%201/approvals/m%3Ac1_0", { status: 204 }],
    ["POST /v1/sessions/s%201/approvals/m%3Ac1_0/hold", { status: 204 }],
    ["GET /v1/sessions/s%201/questions", { status: 200, body: [] }],
    ["POST /v1/sessions/s%201/plan/accept", { status: 202, body: started }],
    ["GET /v1/sessions/s%201/diff", { status: 200, body: [{ kind: "none" }] }],
    ["POST /v1/attachments", { status: 200, body: { id: "att_1" } }],
    ["POST /v1/shutdown", { status: 202, body: {} }],
  ];
  for (const [key, reply] of replies) {
    stub.replies.set(key, reply);
  }
  try {
    assert.equal((await client.info()).name, "VantheaX");
    assert.equal((await client.models())[0].id, "a/b");
    assert.equal((await client.sessions.create({ cwd: "D:/proj", mode: "full" })).id, "s 1");
    assert.deepEqual(await client.sessions.list(), []);
    assert.equal((await client.sessions.get("s 1")).id, "s 1");
    assert.equal(await client.sessions.remove("s 1"), undefined);
    assert.deepEqual(await client.prompt("s 1", { text: "hi", approvals: "client" }), started);
    assert.equal((await client.result("s 1", "m1")).text, "final answer");
    await client.stop("s 1");
    await client.steer("s 1", { text: "also this" });
    assert.deepEqual(await client.approvals.list("s 1"), []);
    await client.approvals.reply("s 1", "m:c1_0", { approved: true, grant: "once" });
    await client.approvals.hold("s 1", "m:c1_0");
    assert.deepEqual(await client.questions.list("s 1"), []);
    stub.replies.set("POST /v1/sessions/s%201/questions", { status: 202, body: started });
    assert.deepEqual(await client.questions.answer("s 1", [{ id: "q1", answer: "yes" }]), started);
    stub.replies.set("POST /v1/sessions/s%201/questions", { status: 204 });
    assert.equal(await client.questions.answer("s 1", [{ id: "q2", answer: "no" }]), null);
    await client.questions.dismiss("s 1", ["q3"]);
    assert.deepEqual(await client.plan.accept("s 1", "m1"), started);
    assert.deepEqual(await client.diff("s 1"), [{ kind: "none" }]);
    stub.replies.set("GET /v1/sessions/s%201/diff", { status: 200, body: { kind: "unchanged" } });
    assert.deepEqual(await client.diff("s 1", { path: "src/a b.ts" }), { kind: "unchanged" });
    assert.equal((await client.attachments.upload({ name: "notes ü.txt", mime: "text/plain", bytes: new TextEncoder().encode("hello") })).id, "att_1");
    await client.shutdown();

    assert.deepEqual(
      stub.seen.map((seen) => `${seen.method} ${seen.path}`),
      [
        "GET /v1/info",
        "GET /v1/models",
        "POST /v1/sessions",
        "GET /v1/sessions",
        "GET /v1/sessions/s%201",
        "DELETE /v1/sessions/s%201",
        "POST /v1/sessions/s%201/prompt",
        "GET /v1/sessions/s%201/runs/m1",
        "POST /v1/sessions/s%201/stop",
        "POST /v1/sessions/s%201/steer",
        "GET /v1/sessions/s%201/approvals",
        "POST /v1/sessions/s%201/approvals/m%3Ac1_0",
        "POST /v1/sessions/s%201/approvals/m%3Ac1_0/hold",
        "GET /v1/sessions/s%201/questions",
        "POST /v1/sessions/s%201/questions",
        "POST /v1/sessions/s%201/questions",
        "POST /v1/sessions/s%201/questions",
        "POST /v1/sessions/s%201/plan/accept",
        "GET /v1/sessions/s%201/diff",
        "GET /v1/sessions/s%201/diff",
        "POST /v1/attachments",
        "POST /v1/shutdown",
      ],
    );
    assert.ok(stub.seen.every((seen) => seen.headers.authorization === "Bearer tok"));
    const by_path = (index: number) => json_body(stub.seen[index]);
    assert.deepEqual(by_path(2), { cwd: "D:/proj", mode: "full" });
    assert.equal(stub.seen[2].headers["content-type"], "application/json");
    assert.deepEqual(by_path(6), { text: "hi", approvals: "client" });
    assert.deepEqual(by_path(9), { text: "also this" });
    assert.deepEqual(by_path(11), { approved: true, grant: "once" });
    assert.equal(stub.seen[12].body.length, 0);
    assert.deepEqual(by_path(14), { answers: [{ id: "q1", answer: "yes" }] });
    assert.deepEqual(by_path(16), { dismiss: ["q3"] });
    assert.deepEqual(by_path(17), { message_id: "m1" });
    assert.deepEqual(stub.seen[18].query, {});
    assert.deepEqual(stub.seen[19].query, { path: "src/a b.ts" });
    assert.equal(stub.seen[20].headers["content-type"], "text/plain");
    assert.equal(decodeURIComponent(String(stub.seen[20].headers["x-vx-name"])), "notes ü.txt");
    assert.equal(stub.seen[20].body.toString("utf8"), "hello");
  } finally {
    await close();
  }
});

test("API error bodies become VantheaxError and other failures keep the HTTP status", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 409, body: { error: { code: "session_busy", message: "a turn is active" } } });
  stub.replies.set("GET /v1/info", { status: 502, raw: "<html>bad gateway</html>" });
  try {
    await assert.rejects(client.prompt("s1", { text: "again" }), (error: unknown) => {
      assert.ok(error instanceof VantheaxError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "session_busy");
      assert.equal(error.message, "a turn is active");
      return true;
    });
    await assert.rejects(client.info(), (error: unknown) => {
      assert.ok(error instanceof VantheaxError);
      assert.equal(error.status, 502);
      assert.equal(error.code, "internal");
      assert.match(error.message, /HTTP 502 .*bad gateway/);
      return true;
    });
    await assert.rejects(client.sessions.get("missing"), (error: unknown) => error instanceof VantheaxError && error.code === "not_found");
  } finally {
    await close();
  }
});

const collect = () => {
  const output = { out: "", err: "" };
  return { output, sink: { out: (text: string) => (output.out += text), err: (text: string) => (output.err += text) } };
};

test("account methods use the account routes with their bodies", async () => {
  const { stub, client, close } = await start_stub();
  const info = account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true });
  for (const key of ["GET /v1/account", "POST /v1/account/billing", "POST /v1/account/chatgpt/sign_in", "POST /v1/account/chatgpt/sign_out"]) {
    stub.replies.set(key, { status: 200, body: info });
  }
  try {
    assert.deepEqual(await client.account.get(), info);
    assert.deepEqual(await client.account.set_billing("chatgpt"), info);
    assert.deepEqual(await client.account.sign_in(), info);
    assert.deepEqual(await client.account.sign_in({ fresh: true, consent: true }), info);
    assert.deepEqual(await client.account.sign_out(), info);
    assert.deepEqual(
      stub.seen.map((seen) => `${seen.method} ${seen.path}`),
      ["GET /v1/account", "POST /v1/account/billing", "POST /v1/account/chatgpt/sign_in", "POST /v1/account/chatgpt/sign_in", "POST /v1/account/chatgpt/sign_out"],
    );
    assert.deepEqual(stub.seen.map((seen) => json_body(seen)), [undefined, { billing: "chatgpt" }, {}, { fresh: true, consent: true }, undefined]);
    assert.equal(stub.seen[2].headers["content-type"], "application/json");
    assert.ok(stub.seen.every((seen) => seen.headers.authorization === "Bearer tok"));
  } finally {
    await close();
  }
});

test("follow_sign_in skips stale account events and returns the first one after the attempt left signing_in", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/account/chatgpt/sign_in", { status: 200, body: account_info("chatgpt", { status: "signing_in" }) });
  stub.on_request = (seen) => {
    if (seen.path !== "/v1/account/chatgpt/sign_in") {
      return;
    }
    stub.push("account.changed", account_info("chatgpt").chatgpt, "b.1");
    stub.push("ping", null);
    stub.push("account.changed", account_info("chatgpt", { status: "signing_in" }).chatgpt, "b.2");
    stub.push("account.changed", account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true }).chatgpt, "b.3");
  };
  const opened: AccountInfo[] = [];
  try {
    const info = await follow_sign_in(client, { consent: true }, {}, (started) => opened.push(started));
    assert.deepEqual(info, account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid", plan_enabled: true }));
    assert.deepEqual(opened.map((entry) => entry.chatgpt.status), ["signing_in"]);
    assert.deepEqual(json_body(stub.seen.find((seen) => seen.path === "/v1/account/chatgpt/sign_in")), { consent: true });
    assert.equal(stub.seen.findIndex((seen) => seen.path === "/v1/events") < stub.seen.findIndex((seen) => seen.path === "/v1/account/chatgpt/sign_in"), true);
  } finally {
    await close();
  }
});

test("follow_sign_in reads the account after a resync and returns at once when the start already failed", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/account/chatgpt/sign_in", { status: 200, body: account_info("api", { status: "signing_in" }) });
  stub.replies.set("GET /v1/account", { status: 200, body: account_info("api", { status: "signed_out", error: { code: "declined", detail: "" } }) });
  stub.on_request = (seen) => {
    if (seen.path === "/v1/account/chatgpt/sign_in") {
      stub.push("resync", null);
    }
  };
  try {
    const { output, sink } = collect();
    assert.equal(await run_account(client, { name: "sign-in", fresh: false, consent: false }, "text", {}, sink), 1);
    assert.equal(output.out, "");
    assert.match(output.err, /sign-in page was opened in the browser of the machine that runs VantheaX/);
    assert.match(output.err, /the ChatGPT sign-in did not finish: declined\n$/);
    stub.on_request = () => undefined;
    stub.replies.set("POST /v1/account/chatgpt/sign_in", { status: 200, body: account_info("api", { error: { code: "storage_unavailable", detail: "no safeStorage" } }) });
    const failed = collect();
    assert.equal(await run_account(client, { name: "sign-in", fresh: true, consent: false }, "json", {}, failed.sink), 1);
    assert.deepEqual(JSON.parse(failed.output.out), { type: "account", account: account_info("api", { error: { code: "storage_unavailable", detail: "no safeStorage" } }) });
    assert.equal(failed.output.err, "");
  } finally {
    await close();
  }
});

test("run_account prints the account, the billing switch and the sign-out with their exit codes", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("GET /v1/account", { status: 200, body: account_info("chatgpt", { status: "signed_in", email: "owner@example.invalid" }) });
  stub.replies.set("POST /v1/account/billing", { status: 200, body: account_info("chatgpt") });
  stub.replies.set("POST /v1/account/chatgpt/sign_out", { status: 200, body: account_info("chatgpt", { email: "owner@example.invalid", error: { code: "revocation_unconfirmed", detail: "HTTP 503" } }) });
  try {
    const shown = collect();
    assert.equal(await run_account(client, { name: "account" }, "text", {}, shown.sink), 0);
    assert.equal(
      shown.output.out,
      "billing: chatgpt\nchatgpt: signed_in (owner@example.invalid)\nchatgpt: plan usage is not enabled for this sign-in, run vantheax sign-in --consent to enable it\nclaude billing: api\nclaude: signed_out\n",
    );
    const switched = collect();
    assert.equal(await run_account(client, { name: "billing", billing: "chatgpt" }, "text", {}, switched.sink), 0);
    assert.deepEqual([switched.output.out, switched.output.err], ["billing: chatgpt\n", "vantheax: not signed in to ChatGPT, run vantheax sign-in\n"]);
    assert.deepEqual(json_body(stub.seen.at(-1)), { billing: "chatgpt" });
    const out = collect();
    assert.equal(await run_account(client, { name: "sign-out" }, "text", {}, out.sink), 1);
    assert.deepEqual([out.output.out, out.output.err], ["signed out of ChatGPT\n", "vantheax: revocation_unconfirmed: HTTP 503\n"]);
    assert.deepEqual(account_lines(account_info("api", { email: "owner@example.invalid", error: { code: "revocation_unconfirmed", detail: "" } })), [
      "billing: api",
      "chatgpt: signed_out (owner@example.invalid)",
      "chatgpt error: revocation_unconfirmed",
      "claude billing: api",
      "claude: signed_out",
    ]);
  } finally {
    await close();
  }
});

test("Claude account methods use the Claude routes with their bodies", async () => {
  const { stub, client, close } = await start_stub();
  const info = account_info("api", {}, { status: "signed_in", email: "owner@example.invalid", subscription: "max", auth_method: "claude.ai" }, "claude");
  stub.replies.set("POST /v1/account/claude-billing", { status: 200, body: info });
  stub.replies.set("POST /v1/account/claude/refresh", { status: 200, body: info });
  try {
    assert.deepEqual(await client.account.set_claude_billing("claude"), info);
    assert.deepEqual(await client.account.refresh_claude(), info);
    assert.deepEqual(
      stub.seen.map((seen) => `${seen.method} ${seen.path}`),
      ["POST /v1/account/claude-billing", "POST /v1/account/claude/refresh"],
    );
    assert.deepEqual(stub.seen.map((seen) => json_body(seen)), [{ billing: "claude" }, undefined]);
    assert.equal(stub.seen[0].headers["content-type"], "application/json");
  } finally {
    await close();
  }
});

test("account_lines names the Claude billing and the Claude Code login with email and subscription when known", () => {
  assert.deepEqual(account_lines(account_info("api", {}, { status: "signed_in", email: "owner@example.invalid", subscription: "max" }, "claude")).slice(-2), [
    "claude billing: claude",
    "claude: signed_in (owner@example.invalid, max)",
  ]);
  assert.deepEqual(account_lines(account_info("api", {}, { status: "other_login", subscription: "pro" })).slice(-1), ["claude: other_login (pro)"]);
  assert.deepEqual(account_lines(account_info("api", {}, { status: "unknown" })).slice(-1), ["claude: unknown"]);
});

test("run_account switches the Claude billing and warns while Claude Code is not signed in", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/account/claude-billing", { status: 200, body: account_info("chatgpt", {}, { status: "signed_out" }, "claude") });
  try {
    const switched = collect();
    assert.equal(await run_account(client, { name: "claude-billing", billing: "claude" }, "text", {}, switched.sink), 0);
    assert.deepEqual([switched.output.out, switched.output.err], ["claude billing: claude\n", "vantheax: the Claude Code login is signed_out, run vantheax claude\n"]);
    assert.deepEqual(json_body(stub.seen.at(-1)), { billing: "claude" });
    stub.replies.set("POST /v1/account/claude-billing", { status: 200, body: account_info("chatgpt", {}, { status: "signed_out" }) });
    const back = collect();
    assert.equal(await run_account(client, { name: "claude-billing", billing: "api" }, "text", {}, back.sink), 0);
    assert.deepEqual([back.output.out, back.output.err], ["claude billing: api\n", ""]);
    const json = collect();
    assert.equal(await run_account(client, { name: "claude-billing", billing: "api" }, "json", {}, json.sink), 0);
    assert.deepEqual(JSON.parse(json.output.out), { type: "account", account: account_info("chatgpt", {}, { status: "signed_out" }) });
  } finally {
    await close();
  }
});

test("run_account claude refreshes the login, prints it and names the login command until Claude Code is signed in", async () => {
  const { stub, client, close } = await start_stub();
  const command = "& 'C:/Claude Code/claude.exe' auth login --claudeai";
  try {
    stub.replies.set("POST /v1/account/claude/refresh", { status: 200, body: account_info("api", {}, { status: "signed_in", email: "owner@example.invalid", subscription: "max", login_command: command }) });
    const signed = collect();
    assert.equal(await run_account(client, { name: "claude" }, "text", {}, signed.sink), 0);
    assert.deepEqual([signed.output.out, signed.output.err], ["claude: signed_in (owner@example.invalid, max)\n", ""]);
    stub.replies.set("POST /v1/account/claude/refresh", { status: 200, body: account_info("api", {}, { status: "signed_out", login_command: command }) });
    const out = collect();
    assert.equal(await run_account(client, { name: "claude" }, "text", {}, out.sink), 1);
    assert.equal(out.output.out, "claude: signed_out\n");
    assert.equal(out.output.err, `vantheax: sign in to Claude Code with your Claude subscription, run this in PowerShell on the machine that runs VantheaX: ${command}\n`);
    stub.replies.set("POST /v1/account/claude/refresh", { status: 200, body: account_info("api", {}, { status: "missing", detail: "the Claude Code executable is missing at C:/x/claude.exe" }) });
    const missing = collect();
    assert.equal(await run_account(client, { name: "claude" }, "text", {}, missing.sink), 1);
    assert.deepEqual([missing.output.out, missing.output.err], ["claude: missing\n", "vantheax: the Claude Code executable is missing at C:/x/claude.exe\n"]);
    const json = collect();
    assert.equal(await run_account(client, { name: "claude" }, "json", {}, json.sink), 1);
    assert.equal(JSON.parse(json.output.out).account.claude.status, "missing");
    assert.ok(stub.seen.every((seen) => seen.method === "POST" && seen.path === "/v1/account/claude/refresh"));
  } finally {
    await close();
  }
});

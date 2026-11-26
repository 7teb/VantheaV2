import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiEvent, ApprovalInfo } from "../shared/api/contract.ts";
import { VantheaxError } from "../sdk/http.ts";
import { json_body, result_of, start_stub, turn_event } from "./sdk-client-kit.ts";

test("run opens the event stream before prompting and resolves on run.settled of its own run", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 202, body: { run_id: "m1", user_message_id: "u1", message_id: "m1" } });
  stub.replies.set("GET /v1/sessions/s1/runs/m1", { status: 200, body: result_of("m1", "done") });
  stub.on_request = (seen) => {
    if (seen.path !== "/v1/sessions/s1/prompt") {
      return;
    }
    stub.push("turn.event", turn_event("m1", { type: "text", round: 1, delta: "hi" }, 1), "b.1");
    stub.push("run.settled", { session_id: "s1", run_id: "m0", status: "done" }, "b.2");
    stub.push("turn.event", turn_event("m1", { type: "end", status: "done", error: null }, 2), "b.3");
    stub.push("run.settled", { session_id: "s1", run_id: "m1", status: "done" }, "b.4");
  };
  try {
    const seen: ApiEvent[] = [];
    const started: string[] = [];
    const result = await client.run("s1", { text: "hello" }, { on_event: (event) => seen.push(event), on_started: (info) => started.push(info.run_id) });
    assert.equal(result.text, "final answer");
    assert.deepEqual(started, ["m1"]);
    assert.deepEqual(
      seen.map((event) => event.type),
      ["hello", "turn.event", "run.settled", "turn.event", "run.settled"],
    );
    assert.deepEqual(
      stub.seen.map((entry) => `${entry.method} ${entry.path}`),
      ["GET /v1/events", "POST /v1/sessions/s1/prompt", "GET /v1/sessions/s1/runs/m1"],
    );
    assert.equal(stub.seen[0].query.session, "s1");
    assert.deepEqual(json_body(stub.seen[1]), { text: "hello" });
  } finally {
    await close();
  }
});

test("run answers each pending approval once through on_approval", async () => {
  const { stub, client, close } = await start_stub();
  const approval: ApprovalInfo = {
    approval_id: "m:request-1",
    source: "main",
    agent_id: null,
    run_id: null,
    call_id: "c1_0",
    request: { kind: "command", command: "npm test", cwd: "D:/proj", background: false, review: null, grant_prefix: null, request_id: "request-1" },
  };
  const approval_path = `/v1/sessions/s1/approvals/${encodeURIComponent(approval.approval_id)}`;
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 202, body: { run_id: "m1", user_message_id: "u1", message_id: "m1" } });
  stub.replies.set("GET /v1/sessions/s1/approvals", { status: 200, body: [] });
  stub.replies.set("GET /v1/sessions/s1/runs/m1", { status: 200, body: result_of("m1", "done") });
  stub.on_request = (seen) => {
    if (seen.path === "/v1/sessions/s1/prompt") {
      stub.replies.set("GET /v1/sessions/s1/approvals", { status: 200, body: [approval] });
      stub.push("turn.event", turn_event("m1", { type: "tool_approval", call_id: "c1_0", request: approval.request }, 1), "b.1");
      stub.push("agent.approvals_changed", { chat_id: "s1", approvals: [] }, "b.2");
    }
    if (seen.path === approval_path) {
      stub.push("run.settled", { session_id: "s1", run_id: "m1", status: "done" }, "b.3");
    }
  };
  stub.replies.set(`POST ${approval_path}`, { status: 204 });
  try {
    const asked: ApprovalInfo[] = [];
    const result = await client.run(
      "s1",
      { text: "run the tests", approvals: "client" },
      {
        on_approval: async (info) => {
          asked.push(info);
          return { approved: true, grant: "once" };
        },
      },
    );
    assert.equal(result.status, "done");
    assert.deepEqual(asked, [approval]);
    const replies = stub.seen.filter((entry) => entry.path === approval_path);
    assert.equal(replies.length, 1);
    assert.deepEqual(json_body(replies[0]), { approved: true, grant: "once" });
  } finally {
    await close();
  }
});

test("run with until turn returns after the end event and the settled session update", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 202, body: { run_id: "m1", user_message_id: "u1", message_id: "m1" } });
  stub.replies.set("GET /v1/sessions/s1/runs/m1", { status: 200, body: result_of("m1", "running") });
  stub.on_request = (seen) => {
    if (seen.path !== "/v1/sessions/s1/prompt") {
      return;
    }
    stub.push("session.updated", { id: "s1", streaming: false }, "b.1");
    stub.push("turn.event", turn_event("m1", { type: "end", status: "done", error: null }, 1), "b.2");
    stub.push("session.updated", { id: "s1", streaming: false }, "b.3");
  };
  try {
    const seen: string[] = [];
    const result = await client.run("s1", { text: "go" }, { until: "turn", on_event: (event) => seen.push(event.id ?? "") });
    assert.equal(result.status, "running");
    assert.deepEqual(seen, ["b.0", "b.1", "b.2", "b.3"]);
  } finally {
    await close();
  }
});

test("wait returns at once for a settled run and after resync re-reads the result", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("GET /v1/sessions/s1/runs/m1", { status: 200, body: result_of("m1", "done") });
  try {
    assert.equal((await client.wait("s1", "m1")).status, "done");
    assert.deepEqual(
      stub.seen.map((entry) => entry.path),
      ["/v1/events", "/v1/sessions/s1/runs/m1"],
    );
    stub.seen.length = 0;
    stub.replies.set("GET /v1/sessions/s1/runs/m2", { status: 200, body: result_of("m2", "running") });
    stub.on_request = (seen) => {
      if (seen.path === "/v1/sessions/s1/runs/m2" && stub.seen.filter((entry) => entry.path === seen.path).length === 1) {
        stub.replies.set("GET /v1/sessions/s1/runs/m2", { status: 200, body: result_of("m2", "failed") });
        stub.push("resync", null);
      }
    };
    assert.equal((await client.wait("s1", "m2")).status, "failed");
    assert.deepEqual(
      stub.seen.map((entry) => entry.path),
      ["/v1/events", "/v1/sessions/s1/runs/m2", "/v1/sessions/s1/runs/m2"],
    );
  } finally {
    await close();
  }
});

test("wait until turn counts a turn that ended before the stream opened", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("GET /v1/sessions/s1", { status: 200, body: { id: "s1", streaming: true, messages: [{ id: "m1", role: "assistant", status: "done" }] } });
  stub.replies.set("GET /v1/sessions/s1/runs/m1", { status: 200, body: result_of("m1", "running") });
  stub.on_request = (seen) => {
    if (seen.path === "/v1/sessions/s1/runs/m1") {
      stub.push("session.updated", { id: "s1", streaming: false }, "b.1");
    }
  };
  try {
    assert.equal((await client.wait("s1", "m1", { until: "turn" })).run_id, "m1");
    assert.deepEqual(
      stub.seen.map((entry) => entry.path),
      ["/v1/events", "/v1/sessions/s1", "/v1/sessions/s1/runs/m1", "/v1/sessions/s1/runs/m1"],
    );
  } finally {
    await close();
  }
});

test("aborting a run rejects it and closes the event stream", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 202, body: { run_id: "m1", user_message_id: "u1", message_id: "m1" } });
  const controller = new AbortController();
  stub.on_request = (seen) => {
    if (seen.path === "/v1/sessions/s1/prompt") {
      setTimeout(() => controller.abort(), 20);
    }
  };
  try {
    await assert.rejects(client.run("s1", { text: "long" }, { signal: controller.signal }), (error: unknown) => error instanceof Error && error.name === "AbortError");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stub.streams.length, 0);
  } finally {
    await close();
  }
});

test("wait answers pending approvals through on_approval like run", async () => {
  const { stub, client, close } = await start_stub();
  const approval: ApprovalInfo = {
    approval_id: "a:agent_1:run_1:request-2",
    source: "agent",
    agent_id: "agent_1",
    run_id: "run_1",
    call_id: "c0_2",
    request: { kind: "command", command: "npm run build", cwd: "D:/proj", background: false, review: null, grant_prefix: null, request_id: "request-2" },
  };
  const approval_path = `/v1/sessions/s1/approvals/${encodeURIComponent(approval.approval_id)}`;
  stub.replies.set("GET /v1/sessions/s1/runs/m4", { status: 200, body: result_of("m4", "running") });
  stub.replies.set("GET /v1/sessions/s1/approvals", { status: 200, body: [approval] });
  stub.replies.set(`POST ${approval_path}`, { status: 204 });
  stub.on_request = (seen) => {
    if (seen.path === approval_path) {
      stub.replies.set("GET /v1/sessions/s1/runs/m4", { status: 200, body: result_of("m4", "done") });
      stub.push("run.settled", { session_id: "s1", run_id: "m4", status: "done" }, "b.1");
    }
  };
  try {
    const asked: string[] = [];
    const seen: string[] = [];
    const result = await client.wait("s1", "m4", {
      on_event: (event) => seen.push(event.type),
      on_approval: (info) => {
        asked.push(info.approval_id);
        return { approved: false, feedback: "not now" };
      },
    });
    assert.equal(result.status, "done");
    assert.deepEqual(asked, [approval.approval_id]);
    assert.deepEqual(seen, ["hello", "run.settled"]);
    const reply = stub.seen.find((entry) => entry.path === approval_path);
    assert.deepEqual(json_body(reply), { approved: false, feedback: "not now" });
  } finally {
    await close();
  }
});

test("a run whose instance shuts down rejects with shutting_down instead of a reconnect error", async () => {
  const { stub, client, close } = await start_stub();
  stub.replies.set("POST /v1/sessions/s1/prompt", { status: 202, body: { run_id: "m1", user_message_id: "u1", message_id: "m1" } });
  stub.on_request = (seen) => {
    if (seen.path !== "/v1/sessions/s1/prompt") {
      return;
    }
    stub.push("turn.event", turn_event("m1", { type: "end", status: "interrupted", error: { kind: "app_closed", message: "VantheaX was closed" } }, 1), "b.1");
    setTimeout(() => void close(), 20);
  };
  try {
    await assert.rejects(client.run("s1", { text: "long" }), (error: unknown) => {
      assert.ok(error instanceof VantheaxError);
      assert.equal(error.code, "shutting_down");
      assert.match(error.message, /shut down while run m1 was open/);
      return true;
    });
  } finally {
    await close();
  }
});

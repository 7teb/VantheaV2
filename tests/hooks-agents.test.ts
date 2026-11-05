import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Hook } from "../shared/hooks.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { Tool } from "../electron/tools/types.ts";
import { completed, reports, request, scripts, start_runner, stop_runner, tools } from "./agents-runner-harness.ts";
import { hook, ps_path, read_stdin, set_hooks, start_settings, temp_root } from "./hooks-kit.ts";

let root = "";

before(async () => {
  root = await temp_root("agents");
  await start_settings(root);
  await start_runner();
});

after(async () => {
  await stop_runner();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const only = (...hooks: Hook[]) => set_hooks({ global: hooks, projects: {} });

const reported = async (run_id: string) => {
  const deadline = Date.now() + 30_000;
  while (!reports.some((report) => report.run_id === run_id)) {
    if (Date.now() > deadline) {
      throw new Error(`run ${run_id} did not report`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return reports.find((report) => report.run_id === run_id)!;
};

const counted_tool = (name: string) => {
  const calls = { count: 0 };
  const tool: Tool = {
    spec: { name, description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker", "explore"],
    available: () => true,
    execute: async () => {
      calls.count += 1;
      return { status: "done", text: `${name} ran`, view: null };
    },
  };
  tools.push(tool);
  return calls;
};

const calling = (name: string) => {
  const seen: ApiMessage[][] = [];
  const script = async (messages: ApiMessage[]) => {
    seen.push([...messages]);
    return seen.length === 1 ? completed({ tool_calls: [{ index: 0, id: "p0", name, arguments: "{}" }] }) : completed({ content: "finished" });
  };
  return { seen, script };
};

const texts = (messages: ApiMessage[] | undefined) => (messages ?? []).flatMap((message) => (typeof message.content === "string" ? [message.content] : []));

test("a worker's tool call fires PreToolUse and the input names the agent", async () => {
  const out = path.join(root, "agent-stdin.json");
  await only(hook({ matcher: "agent_probe", command: `[IO.File]::WriteAllText('${ps_path(out)}', [Console]::In.ReadToEnd())` }));
  const calls = counted_tool("agent_probe");
  const { script } = calling("agent_probe");
  scripts.set("probe the repo", script);
  const started = deploy_agent(request("probe the repo", { name: "Prober" }));
  assert.equal((await reported(started.run.run_id)).status, "completed");
  assert.equal(calls.count, 1);
  const input = JSON.parse(await fs.readFile(out, "utf8"));
  assert.equal(input.hook_event_name, "PreToolUse");
  assert.equal(input.tool_name, "agent_probe");
  assert.equal(input.agent_type, "worker");
  assert.equal(input.agent_id, started.agent.agent_id);
  assert.equal(input.agent_name, "Prober");
  assert.equal(input.turn_id, started.run.run_id);
  assert.equal(input.permission_mode, "ask");
});

test("a PreToolUse block stops the sub-agent's call", async () => {
  await only(hook({ matcher: "agent_blocked", command: "[Console]::Error.WriteLine('agents may not'); exit 2" }));
  const calls = counted_tool("agent_blocked");
  const { seen, script } = calling("agent_blocked");
  scripts.set("try the blocked tool", script);
  const started = deploy_agent(request("try the blocked tool"));
  await reported(started.run.run_id);
  assert.equal(calls.count, 0);
  assert.ok(texts(seen[1]).some((text) => text.includes("Blocked by a PreToolUse hook the user set up") && text.includes("agents may not")));
});

test("SubagentStart context reaches the agent's first request", async () => {
  const json = `Write-Output '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"use the staging database"}}'`;
  await only(hook({ event: "SubagentStart", matcher: "worker", command: json }));
  const seen: ApiMessage[][] = [];
  scripts.set("start with context", async (messages) => {
    seen.push([...messages]);
    return completed({ content: "noted" });
  });
  const started = deploy_agent(request("start with context"));
  await reported(started.run.run_id);
  assert.ok(texts(seen[0]).some((text) => text.startsWith("Output of a SubagentStart hook the user set up") && text.includes("use the staging database")));
});

test("SubagentStop with exit 2 keeps the agent working for one more round", async () => {
  await only(hook({ event: "SubagentStop", command: `${read_stdin}; if (-not $e.stop_hook_active) { [Console]::Error.WriteLine('write the summary file'); exit 2 }` }));
  const seen: ApiMessage[][] = [];
  scripts.set("stop once", async (messages) => {
    seen.push([...messages]);
    return completed({ content: seen.length === 1 ? "done early" : "summary written" });
  });
  const started = deploy_agent(request("stop once"));
  const report = await reported(started.run.run_id);
  assert.equal(seen.length, 2);
  assert.ok(texts(seen[1]).includes("A SubagentStop hook the user set up asked you to continue before ending the run:\nwrite the summary file"));
  assert.equal(report.status, "completed");
});

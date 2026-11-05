import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_run } from "../electron/agents/live.ts";
import { overlaps, roster_entries } from "../electron/agents/roster.ts";
import { deploy_agent, max_running_agents, type StartedRun } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import { deploy_agent_tool } from "../electron/tools/agents/start.ts";
import type { Tool } from "../electron/tools/types.ts";
import { register_active, unregister_active } from "../electron/turn/active.ts";
import { block_until_abort, completed, events, model, project, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";
import { allowed_peer_tool, calls, is_peer_note, label, reported, stepper, stop_chat, tool_context } from "./peer-flow-kit.ts";
import { answer, review_stub } from "./review-stub.ts";

before(start_runner);

after(stop_runner);

const writer: Tool = {
  spec: { name: "pf_write", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async (_ctx, raw) => ({ status: "done", text: "wrote", view: { kind: "edit", path: String(raw.path), created: false, added: 1, removed: 0, diff: [] } }),
};

tools.push(writer, allowed_peer_tool);

const wrote = (run_id: string, file: string) =>
  (live_run(run_id)?.transcript.steps ?? []).some((step) => step.kind === "tool" && step.status === "done" && step.view?.kind === "edit" && step.view.path === file);

const deploy_through_tool = async (chat_id: string, args: Record<string, unknown>) => {
  const result = await deploy_agent_tool.execute(tool_context(chat_id, "main"), args);
  assert.equal(result.status, "done", result.text);
  const agent_id = result.view?.kind === "agent" ? result.view.agent_id : "";
  const run_id = result.view?.kind === "agent" ? result.view.run_id : "";
  return { agent_id, run_id, text: result.text };
};

const with_main_turn = async (chat_id: string, body: () => Promise<void>) => {
  scripts.set("pf scope writer", stepper([async () => calls(["pf_write", { path: "src/x.ts" }]), block_until_abort]));
  register_active(chat_id, `turn-${chat_id}`, () => undefined, model, "");
  try {
    await body();
  } finally {
    await stop_chat(chat_id);
    unregister_active(chat_id, `turn-${chat_id}`);
  }
};

scripts.set("pf scope owner", block_until_abort);

test("a scope given as an absolute project path is stored relative and overlaps with a peer's write inside it", async () => {
  await with_main_turn("pf-scope-abs", async () => {
    const owner = await deploy_through_tool("pf-scope-abs", { name: "Owner", description: "owns src", topic: "core", scope: [path.join(project, "src")], prompt: "pf scope owner", profile: "worker" });
    assert.deepEqual(get_agent(owner.agent_id)?.scope, ["src"]);
    assert.match(owner.text, /No other agent of this chat is running\.$/);
    const peer = await deploy_through_tool("pf-scope-abs", { name: "Peer", description: "writes x", topic: "ui", prompt: "pf scope writer", profile: "worker" });
    assert.match(peer.text, /Running agents of this chat: Owner#[0-9a-f]{8} \(topic core\)\. Give related work the same topic word so those agents coordinate directly\.$/);
    await wait_for(() => wrote(peer.run_id, "src/x.ts"));
    const live = live_run(owner.run_id);
    assert.ok(live);
    const found = overlaps(live, roster_entries("pf-scope-abs"));
    assert.equal(found.length, 1);
    assert.match(found[0] ?? "", /^Overlap with Peer#[0-9a-f]{8} \(topic ui\): Peer#[0-9a-f]{8} wrote src\/x\.ts, which is in your scope\./);
  });
});

test("a scope that names the whole project overlaps with a peer's write anywhere in it", async () => {
  await with_main_turn("pf-scope-root", async () => {
    const dotted = await deploy_through_tool("pf-scope-root", { name: "Dotted", description: "owns the project", topic: "core", scope: ["./"], prompt: "pf scope owner", profile: "worker" });
    const rooted = await deploy_through_tool("pf-scope-root", { name: "Rooted", description: "owns the project", topic: "core", scope: [project], prompt: "pf scope owner", profile: "worker" });
    const peer = await deploy_through_tool("pf-scope-root", { name: "Peer", description: "writes x", topic: "ui", prompt: "pf scope writer", profile: "worker" });
    await wait_for(() => wrote(peer.run_id, "src/x.ts"));
    const found = [dotted, rooted].map((owner) => {
      const live = live_run(owner.run_id);
      assert.ok(live);
      const scope = JSON.stringify(get_agent(owner.agent_id)?.scope);
      return `${scope}: ${overlaps(live, roster_entries("pf-scope-root")).filter((text) => text.includes("Peer#")).length}`;
    });
    assert.deepEqual(found, [`["."]: 1`, `["."]: 1`]);
  });
});

test("twenty agents run at once, see each other in the roster, message each other in a ring and all finish; a twenty-first is refused", async () => {
  const chat_id = "pf-twenty";
  const count = max_running_agents;
  assert.equal(count, 20);
  const started: StartedRun[] = [];
  for (let index = 0; index < count; index += 1) {
    const own = index;
    scripts.set(
      `pf ring ${own}`,
      stepper([
        async () => {
          await wait_for(() => started.length === count && started.every((entry) => live_run(entry.run.run_id) !== null));
          const next = started[(own + 1) % count];
          assert.ok(next);
          return calls(["message_peer", { to: label(next), type: "info", about: `slot ${own}`, summary: "ring step", text: `ring message from ${own}` }]);
        },
        async (messages) => {
          if (messages.some(is_peer_note)) {
            return completed({ content: `ring ${own} done` });
          }
          await wait_for(() => (live_run(started[own]?.run.run_id ?? "")?.inbox.length ?? 0) > 0);
          return completed({ content: "" });
        },
        async () => completed({ content: `ring ${own} done` }),
      ]),
    );
  }
  for (let index = 0; index < count; index += 1) {
    started.push(deploy_agent(request(`pf ring ${index}`, { chat_id, name: `Ring${index}`, topic: "ring" })));
  }
  assert.throws(() => deploy_agent(request("pf ring 0", { chat_id, name: "Extra", topic: "ring" })), /At most 20 agents can run at once in this chat/);
  for (const entry of started) {
    await reported(entry.run.run_id);
  }
  for (const entry of started) {
    assert.equal(reports.find((report) => report.run_id === entry.run.run_id)?.status, "completed");
    const received = events.filter((event) => event.run_id === entry.run.run_id && event.type === "notice" && event.notice === "peer_message");
    assert.equal(received.length, 1, `${entry.agent.name} received ${received.length} peer messages`);
  }
  const last = started.at(-1);
  assert.ok(last);
  const snapshot = events.find((event) => event.run_id === last.run.run_id && event.type === "notice" && event.notice === "agent_roster");
  const lines = snapshot?.type === "notice" ? snapshot.text.split("\n") : [];
  assert.equal(lines.filter((line) => line.startsWith("- Ring")).length, count);
  assert.equal(lines.filter((line) => line.includes("(same topic as you)")).length, count - 1);
});

test("a deploy over the running-agent limit is refused before the review is asked", async () => {
  const chat_id = "pf-cap";
  const started = Array.from({ length: max_running_agents }, (_, index) => deploy_agent(request("pf scope owner", { chat_id, name: `Cap${index}`, topic: "cap" })));
  register_active(chat_id, `turn-${chat_id}`, () => undefined, model, "");
  try {
    await wait_for(() => started.every((entry) => live_run(entry.run.run_id) !== null));
    const stub = review_stub([answer("allow")]);
    const result = await deploy_agent_tool.execute(tool_context(chat_id, "main", { review: stub }), { name: "Extra", description: "one too many", topic: "cap", prompt: "pf scope owner", profile: "worker" });
    assert.equal(result.status, "failed");
    assert.match(result.text, /At most 20 agents can run at once in this chat/);
    assert.equal(stub.calls.length, 0);
  } finally {
    await stop_chat(chat_id);
    unregister_active(chat_id, `turn-${chat_id}`);
  }
});

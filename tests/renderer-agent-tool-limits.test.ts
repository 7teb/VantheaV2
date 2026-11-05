import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { AgentSummary } from "../shared/ipc/work.ts";
import { bundle, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const agent = (without_tools: string[]): AgentSummary => ({
  agent_id: "agent_reader",
  chat_id: "c1",
  name: "Reader",
  description: "reads the parser",
  topic: "parser",
  model: "test/model",
  profile: "worker",
  without_tools,
  runs: [{ run_id: "run_1", prompt: "read the parser", status: "completed", started_at: "2026-10-15T10:00:00.000Z", ended_at: "2026-10-15T10:01:00.000Z", report: "", open_questions: 0 }],
});

const meta = () => container.matching((element) => element.className.split(" ").includes("agent-entry-meta"))[0];

const show = (summary: AgentSummary) => client.flushSync(() => root.render(client.createElement(client.AgentEntry, { agent: summary, now: Date.parse("2026-10-15T10:05:00.000Z") })));

const card = (tool: "deploy_agent" | "continue_agent", without_tools?: string[]): ApprovalRequest => ({
  kind: "agent_message",
  tool,
  to_name: "Reader",
  to_id: tool === "deploy_agent" ? null : "agent_reader",
  about: "parser",
  text: "read the parser",
  ...(without_tools ? { without_tools } : {}),
});

const card_lines = (request: ApprovalRequest) => {
  client.flushSync(() => root.render(client.createElement(client.ApprovalDetail, { request })));
  return container.matching((element) => element.className.split(" ").includes("approval-reason")).map((element) => element.textContent);
};

const detail_stubs = {
  ApprovalEnv: "export const ApprovalEnv = () => null;",
  "bodies-files": "export const EditCard = () => null;",
  Collapsible: "export const Collapsible = () => null;",
};

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { AgentEntry } from "./src/features/docks/agents/AgentEntry.tsx";',
      'export { ApprovalDetail } from "./src/features/tools/ApprovalDetail.tsx";',
      'export { set_language } from "./src/i18n/index.ts";',
    ],
    [stub_components("ApprovalDetail.tsx", detail_stubs)],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("the agent panel names the tools removed from the profile next to the profile", () => {
  show(agent(["run_command", "run_bash"]));
  assert.equal(meta()?.textContent, "parser · Worker · without run_command, run_bash · test/model");
  assert.equal(meta()?.getAttribute("title"), "parser · Worker · without run_command, run_bash · test/model");
});

test("an agent without removed tools shows the meta line as before", () => {
  show(agent([]));
  assert.equal(meta()?.textContent, "parser · Worker · test/model");
});

test("a deploy_agent or continue_agent approval card names the removed tools only when there are any", () => {
  assert.deepEqual(card_lines(card("deploy_agent", ["run_command", "run_bash"])), ["About parser", "Without: run_command, run_bash"]);
  assert.deepEqual(card_lines(card("continue_agent", ["run_bash"])), ["About parser", "Without: run_bash"]);
  assert.deepEqual(card_lines(card("continue_agent", [])), ["About parser"]);
  assert.deepEqual(card_lines(card("deploy_agent")), ["About parser"]);
  client.flushSync(() => client.set_language("de"));
  try {
    assert.deepEqual(card_lines(card("deploy_agent", ["run_command", "run_bash"])), ["Zu parser", "Ohne: run_command, run_bash"]);
  } finally {
    client.flushSync(() => client.set_language("en"));
  }
});

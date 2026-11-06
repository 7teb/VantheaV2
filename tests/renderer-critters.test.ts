import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SteerStep, ToolStep } from "../shared/chat.ts";
import type { AgentRunStatus, AgentSummary } from "../shared/ipc/work.ts";
import { bundle, install_dom, quiet_vx, stub_components, type FakeElement } from "./dom-kit.ts";

let client: any;
let container: FakeElement;
let root: any;
let restore = () => {};

const agent = (name: string, status: AgentRunStatus): AgentSummary => ({
  agent_id: `agent_${name.toLowerCase()}`,
  chat_id: "c1",
  name,
  description: "",
  topic: "parser",
  model: "test/model",
  effort: "high",
  profile: "worker",
  without_tools: [],
  runs: [{ run_id: "run_1", prompt: "read the parser", status, started_at: "2026-10-15T10:00:00.000Z", ended_at: null, report: "", open_questions: 0 }],
});

const render = (element: unknown) => client.flushSync(() => root.render(element));

const critters = () => container.matching((element) => element.className.split(" ").includes("critter"));

before(async () => {
  const dom = install_dom(quiet_vx);
  restore = dom.restore;
  client = await bundle(
    [
      'export { createElement } from "react";',
      'export { flushSync } from "react-dom";',
      'export { createRoot } from "react-dom/client";',
      'export { AgentEntry } from "./src/features/docks/agents/AgentEntry.tsx";',
      'export { CritterIcon } from "./src/components/icons-critters.tsx";',
      'export { AgentCritter } from "./src/features/tools/AgentCritter.tsx";',
      'export { MainMessageRow } from "./src/features/chat/MainMessageRow.tsx";',
    ],
    [stub_components("AgentEntry.tsx", {})],
  );
  container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = client.createRoot(container);
});

after(() => {
  root?.unmount();
  restore();
});

test("an agent in the panel gets a colored critter that hops only while it runs", () => {
  const now = Date.parse("2026-10-15T10:05:00.000Z");
  render(client.createElement(client.AgentEntry, { agent: agent("Reader", "running"), now }));
  const [running] = critters();
  assert.ok(running?.getAttribute("data-glyph"));
  assert.ok(running?.className.split(" ").includes("is-running"));
  render(client.createElement(client.AgentEntry, { agent: agent("Reader", "completed"), now }));
  const [done] = critters();
  assert.equal(done?.getAttribute("data-glyph"), running?.getAttribute("data-glyph"));
  assert.ok(!done?.className.split(" ").includes("is-running"));
});

test("the same name always gets the same critter and names spread over several critters", () => {
  const names = ["Reader", "Writer", "Auditor", "Scout", "Builder", "Verifier", "Fixer", "Planner", "Tester", "Mapper"];
  const keys = names.map((name) => {
    render(client.createElement(client.CritterIcon, { name }));
    return critters()[0]?.getAttribute("data-glyph");
  });
  render(client.createElement(client.CritterIcon, { name: "Reader" }));
  assert.equal(critters()[0]?.getAttribute("data-glyph"), keys[0]);
  assert.ok(new Set(keys).size > 2);
});

test("a row without a specific agent gets the neutral critter in the row color", () => {
  render(client.createElement(client.CritterIcon, { name: null }));
  const [neutral] = critters();
  assert.equal(neutral?.getAttribute("data-glyph"), null);
  assert.equal(neutral?.getAttribute("viewBox"), "0 0 5 5");
});

test("the pool holds the 5x5 critters, the 7x7 critters and the blooms, each bloom with a tint and a spin while running", () => {
  const shapes = new Map<string, { view: string | null; tint: string | null }>();
  for (let index = 0; index < 400 && shapes.size < 24; index += 1) {
    render(client.createElement(client.CritterIcon, { name: `agent ${index}`, running: true }));
    const [icon] = critters();
    shapes.set(icon?.getAttribute("data-glyph") ?? "", { view: icon?.getAttribute("viewBox") ?? null, tint: icon?.getAttribute("data-tint") ?? null });
  }
  assert.equal(shapes.size, 24);
  const views = [...shapes.values()].map((shape) => shape.view);
  assert.equal(views.filter((view) => view === "0 0 5 5").length, 8);
  assert.equal(views.filter((view) => view === "0 0 7 7").length, 8);
  assert.equal(views.filter((view) => view === "0 0 24 24").length, 8);
  assert.ok([...shapes.values()].every((shape) => shape.tint !== null));
  render(client.createElement(client.CritterIcon, { name: "agent 0", running: true }));
  assert.ok(critters()[0]?.className.split(" ").includes("is-running"));
});

const main_steer: SteerStep = { id: "steer:4", round: 2, kind: "steer", text: "Stop editing tokens.ts, the parser agent owns it." };

const message_main: ToolStep = {
  id: "tool:3:0",
  round: 3,
  kind: "tool",
  index: 0,
  call_id: "call-3",
  name: "message_main_agent",
  args: { text: "tokens.ts is done" },
  status: "done",
  progress: null,
  approval: null,
  view: { kind: "text", text: "tokens.ts is done" },
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: 2000,
};

test("a message from the main agent shows as a closed row with the main agent's critter, which stays the same for the whole chat", () => {
  render(client.createElement(client.MainMessageRow, { chat_id: "c1", step: main_steer }));
  assert.equal(container.textContent, "Received a message from the parent agent");
  const from_row = critters()[0]?.getAttribute("data-glyph");
  assert.ok(from_row);
  render(client.createElement(client.AgentCritter, { chat_id: "c1", step: message_main }));
  assert.equal(critters()[0]?.getAttribute("data-glyph"), from_row);
  const chats = ["c2", "c3", "c4", "c5", "c6", "c7"].map((chat_id) => {
    render(client.createElement(client.MainMessageRow, { chat_id, step: main_steer }));
    return critters()[0]?.getAttribute("data-glyph");
  });
  assert.ok(new Set(chats).size > 1);
});

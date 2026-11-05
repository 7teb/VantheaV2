import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { agent_detail } from "../electron/agents/detail.ts";
import { parse_index, stored_index, type AgentRecord, type RunRecord } from "../electron/agents/records.ts";
import { begin_run, create_agent, end_run, find_agent, get_agent, init_agent_store, take_held } from "../electron/agents/store.ts";
import { cap_text, estimate_tokens, result_cap_tokens } from "../electron/context/estimate.ts";

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-peer-detail-"));
  await init_agent_store(path.join(root, "agents"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const finished_agent = (chat_id: string, prompt: string, report: string): { agent: AgentRecord; run: RunRecord } => {
  const agent = create_agent({ chat_id, name: "Docs", description: "writes docs", topic: "parser", scope: [], model: "m", effort: "", profile: "worker", without_tools: [], project_root: root });
  const run = begin_run(agent, prompt, "parent");
  const ended = end_run(agent.agent_id, run.run_id, "completed", report);
  assert.ok(ended);
  return { agent, run: ended };
};

const report_lines = (count: number) => Array.from({ length: count }, (_, at) => `line ${String(at).padStart(6, "0")} of the report`).join("\n");

const as_tool_result = (text: string) => cap_text(text, result_cap_tokens);

test("a sub-agent pages through a long report with report_from and gets every character exactly once", async () => {
  const report = report_lines(5000);
  const { agent, run } = finished_agent("chat-page", "short task", report);
  const pages: string[] = [];
  let from = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const text = await agent_detail(agent, run, "worker", from);
    assert.equal(as_tool_result(text), text, "a page must fit the tool result cap");
    const marker = from ? `Report from character ${from}:\n` : "Report:\n";
    const start = text.indexOf(marker);
    assert.ok(start >= 0, text.slice(0, 300));
    const next = /\[The report continues for \d+ more characters\. Call get_agent_status with agent_id \S+ and report_from (\d+) for the rest\.\]$/.exec(text);
    const body = text.slice(start + marker.length, next ? text.length - next[0].length - 2 : text.length);
    pages.push(body);
    if (!next) {
      break;
    }
    from = Number(next[1]);
  }
  assert.ok(pages.length > 1);
  assert.equal(pages.join(""), report);
});

test("the main agent keeps the report file path when the run detail is larger than the tool result cap", async () => {
  const prompt = `${"Long standalone task with all facts. ".repeat(3000)}END-OF-TASK`;
  assert.ok(estimate_tokens(prompt) > result_cap_tokens);
  const { agent, run } = finished_agent("chat-long-main", prompt, "REPORT-BODY-MAIN");
  const shown = as_tool_result(await agent_detail(agent, run, "main", 0));
  assert.ok(/Report file: .+\.report\.md/.test(shown), shown.slice(-300));
});

test("a sub-agent still reaches the report of a run whose detail is larger than the tool result cap", async () => {
  const prompt = `${"Long standalone task with all facts. ".repeat(3000)}END-OF-TASK`;
  const { agent, run } = finished_agent("chat-long-sub", prompt, "REPORT-BODY-SUB");
  const shown = as_tool_result(await agent_detail(agent, run, "worker", 0));
  assert.ok(shown.includes("REPORT-BODY-SUB") || /report_from \d+/.test(shown), shown.slice(-400));
});

test("agent records saved before topic, scope, held and open_questions existed load with defaults", () => {
  const now = "2026-10-13T10:00:00.000Z";
  const old = {
    version: 1,
    agents: [
      {
        agent_id: "agent_3f2a91c0-1111-4000-8000-000000000001",
        chat_id: "chat-old",
        name: "Lexer",
        description: "old agent",
        model: "m",
        effort: "",
        profile: "worker",
        project_root: "C:/p",
        created_at: now,
        updated_at: now,
        runs: [
          { run_id: "run_a", prompt: "p", status: "completed", started_at: now, ended_at: now, report: "r", parent_message_id: "m" },
          { run_id: "run_b", prompt: "p2", status: "running", started_at: now, ended_at: null, report: "", parent_message_id: "m" },
        ],
      },
    ],
  };
  const { records, interrupted } = parse_index(old, now);
  assert.equal(interrupted, 1);
  const [record] = records;
  assert.deepEqual([record?.topic, record?.scope, record?.held], ["", [], []]);
  assert.deepEqual(
    record?.runs.map((run) => [run.status, run.open_questions]),
    [
      ["completed", 0],
      ["interrupted", 0],
    ],
  );
});

test("held answers and kept main-agent instructions, topic and scope survive a save and reload, and malformed held entries are dropped", async () => {
  const now = "2026-10-13T10:00:00.000Z";
  const held = {
    from: "peer",
    message_id: "msg_000000000001",
    sender_id: "agent_1a2b3c4d-2222-4000-8000-000000000002",
    sender_name: "Parser",
    type: "answer",
    about: "tokens.ts",
    summary: "three kinds",
    text: "Ident, Number, Punct.",
    in_reply_to: "",
  };
  const stored = {
    version: 1,
    agents: [
      {
        agent_id: "agent_3f2a91c0-1111-4000-8000-000000000001",
        chat_id: "chat-held",
        name: "Lexer",
        description: "",
        topic: "parser",
        scope: ["src/parser", 7, "docs"],
        model: "m",
        effort: "",
        profile: "explore",
        project_root: "C:/p",
        created_at: now,
        updated_at: now,
        runs: [],
        held: [held, { ...held, from: "main" }, { from: "main", text: "" }, { ...held, type: "note" }, { ...held, message_id: "" }, "junk"],
      },
    ],
  };
  const dir = path.join(root, "reload");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(stored), "utf8");
  await init_agent_store(dir);
  const agent = get_agent("agent_3f2a91c0-1111-4000-8000-000000000001");
  assert.deepEqual([agent?.topic, agent?.scope], ["parser", ["src/parser", "docs"]]);
  assert.deepEqual(agent?.held, [{ ...held, in_reply_to: null }, { from: "main", text: held.text }]);
  const again = parse_index(JSON.parse(JSON.stringify(stored_index([agent as AgentRecord]))), now).records[0];
  assert.deepEqual([again?.topic, again?.scope, again?.held], [agent?.topic, agent?.scope, agent?.held]);
  for (const id of ["Lexer#3f2a91c0", "3f2a91c0", "Anything#3f2a91c0", "agent_3f2a91c0-1111-4000-8000-000000000001", "agent_3f2a"]) {
    const found = find_agent(id, "chat-held");
    assert.equal(found.agent?.agent_id, "agent_3f2a91c0-1111-4000-8000-000000000001", id);
  }
  assert.equal(find_agent("3f2a91c0", "other-chat").agent, null);
  assert.equal(take_held("agent_3f2a91c0-1111-4000-8000-000000000001").length, 2);
  assert.equal(get_agent("agent_3f2a91c0-1111-4000-8000-000000000001")?.held.length, 0);
  await init_agent_store(path.join(root, "agents"));
});

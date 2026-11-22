import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { SteerMessage } from "../shared/chat.ts";
import { fileURLToPath } from "node:url";
import { claude_env } from "../electron/claude/env.ts";
import { kill_claude_children } from "../electron/claude/process.ts";
import { create_claude_runtime } from "../electron/claude/query.ts";
import { claude_runtime, set_claude_runtime, type ClaudeRuntime, type ClaudeSessionRef } from "../electron/claude/runtime.ts";
import type { Tool } from "../electron/tools/types.ts";
import { run_claude_turn, type ClaudeTurnInput } from "../electron/turn/claude/drive.ts";
import type { CompactionRecord, TurnSession } from "../electron/turn/session.ts";
import { claude_harness, ends, make_tool, open_steps, transcript, type ClaudeHarness } from "./claude-turn-kit.ts";

type Step = Record<string, unknown>;

type LogEntry = { kind: string; argv?: string[]; names?: string[]; frame?: Record<string, unknown>; pid?: number };

const fake = fileURLToPath(new URL("./support/fake-claude.mjs", import.meta.url));

const inherited: Record<string, string> = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SESSION_ID: "parent-session",
  CLAUDE_CODE_SSE_PORT: "1",
  ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
};

const host_names = ["CLAUDE_CONFIG_DIR", ...Object.keys(inherited)];

let root = "";
let config = "";
let project = "";
let scenario_file = "";
let log_file = "";
let auth_failures = 0;
let previous_runtime: ClaudeRuntime | null = null;
const host_env = new Map<string, string | undefined>();

const write_scenario = async (turns: Step[][], auth = "signed_in") => {
  await fs.writeFile(scenario_file, JSON.stringify({ auth, turns }));
  await fs.writeFile(log_file, "");
};

const read_log = async (): Promise<LogEntry[]> =>
  (await fs.readFile(log_file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEntry);

const received = (entries: LogEntry[]) => entries.flatMap((entry) => (entry.kind === "in" && entry.frame ? [entry.frame] : []));

const control = (frames: Record<string, unknown>[], subtype: string) =>
  frames.flatMap((frame) => {
    const request = frame.request as Record<string, unknown> | undefined;
    return frame.type === "control_request" && request?.subtype === subtype ? [request] : [];
  });

const mcp_results = (frames: Record<string, unknown>[]) =>
  frames.flatMap((frame) => {
    const response = frame.response as { response?: { mcp_response?: Record<string, unknown> } } | undefined;
    const answer = frame.type === "control_response" ? response?.response?.mcp_response : undefined;
    return answer ? [answer] : [];
  });

type HarnessOptions = { stored?: ClaudeSessionRef; previous_turn_id?: string; turn_id?: string; session?: Partial<TurnSession>; input?: Partial<ClaudeTurnInput> };

const harness = (tools: Tool[], options: HarnessOptions = {}): ClaudeHarness => {
  const turn_id = options.turn_id ?? "turn-1";
  return claude_harness(tools, { project_root: project, message_id: turn_id, ...options.session }, { stored: options.stored ?? null, previous_turn_id: options.previous_turn_id ?? null, turn_id, ...options.input });
};

const read_tool = () =>
  make_tool("read", async ({ args }) => ({ status: "done", text: `contents of ${String(args.path)}: hello`, view: null }), true);

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-tmp-claude-sdk-"));
  config = path.join(root, "claude-config");
  project = path.join(root, "project");
  scenario_file = path.join(root, "scenario.json");
  log_file = path.join(root, "fake-log.ndjson");
  await fs.mkdir(config);
  await fs.mkdir(project);
  for (const name of host_names) {
    host_env.set(name, process.env[name]);
  }
  process.env.CLAUDE_CONFIG_DIR = config;
  Object.assign(process.env, inherited);
  previous_runtime = claude_runtime();
  set_claude_runtime(
    create_claude_runtime({
      executable: () => fake,
      env: () => ({ ...claude_env(), CLAUDE_CONFIG_DIR: config, VX_FAKE_CLAUDE_SCENARIO: scenario_file, VX_FAKE_CLAUDE_LOG: log_file }),
      auth_failed: () => {
        auth_failures += 1;
      },
    }),
  );
});

after(async () => {
  kill_claude_children();
  if (previous_runtime) {
    set_claude_runtime(previous_runtime);
  }
  for (const [name, value] of host_env) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a Claude-plan turn runs through the real Agent SDK against the fake Claude Code and resumes on the next turn", async () => {
  await write_scenario([[{ thinking: "Let me read it." }, { text: "Reading the file." }, { tool: "read", input: { path: "a.txt" } }, { text: "The file says hello." }, { result: true }]]);
  const first = harness([read_tool()]);
  await run_claude_turn(first.session, first.input);
  assert.deepEqual(ends(first.events), [{ type: "end", status: "done", error: null }]);
  assert.deepEqual(open_steps(first.events), []);
  assert.equal(first.stream_calls(), 0);
  const message = transcript(first.events);
  const tool = message.steps.find((step) => step.kind === "tool");
  assert.ok(tool && tool.kind === "tool");
  assert.deepEqual([tool.name, tool.status, tool.args], ["read", "done", { path: "a.txt" }]);
  assert.deepEqual(
    message.steps.filter((step) => step.kind === "text").map((step) => (step.kind === "text" ? step.text : "")),
    ["Reading the file.", "The file says hello."],
  );
  assert.ok(first.events.some((event) => event.type === "reasoning"));
  assert.equal(first.saved.length, 1);
  const ref = first.saved[0];
  assert.ok(ref);
  assert.deepEqual([ref.cwd, ref.through_message_id], [project, "turn-1"]);

  const log = await read_log();
  const argv = log.find((entry) => entry.kind === "argv")?.argv ?? [];
  assert.ok(argv.includes("--model=claude-opus-5-5"), argv.join(" "));
  assert.ok(argv.includes(`--session-id=${ref.session_id}`), argv.join(" "));
  assert.equal(argv.some((arg) => arg.startsWith("--resume")), false);
  const names = log.find((entry) => entry.kind === "env")?.names ?? [];
  for (const name of Object.keys(inherited).filter((entry) => entry !== "CLAUDE_CODE_ENTRYPOINT")) {
    assert.equal(names.includes(name), false, `${name} reached the child`);
  }
  assert.ok(names.includes("CLAUDE_CONFIG_DIR"));
  const frames = received(log);
  const [initialize] = control(frames, "initialize");
  assert.ok(initialize);
  assert.deepEqual(initialize.systemPrompt, ["system prompt"]);
  assert.deepEqual(initialize.sdkMcpServers, ["vantheax"]);
  const listed = mcp_results(frames).flatMap((answer) => ((answer.result as { tools?: { name: string }[] } | undefined)?.tools ?? []).map((entry) => entry.name));
  assert.ok(listed.includes("read"), JSON.stringify(listed));
  const called = mcp_results(frames).find((answer) => Array.isArray((answer.result as { content?: unknown } | undefined)?.content));
  assert.deepEqual((called?.result as { content: unknown[] }).content[0], { type: "text", text: "contents of a.txt: hello" });
  const users = frames.filter((frame) => frame.type === "user");
  assert.equal(users.length, 1);
  assert.equal((users[0] as { client_composed?: boolean }).client_composed, true);

  await write_scenario([[{ text: "Still here." }, { result: true }]]);
  const second = harness([read_tool()], { stored: ref, previous_turn_id: "turn-1", turn_id: "turn-2" });
  second.api_messages.push({ role: "assistant", content: "The file says hello." }, { role: "user", content: "and now?" });
  await run_claude_turn(second.session, second.input);
  assert.deepEqual(ends(second.events), [{ type: "end", status: "done", error: null }]);
  const resumed = (await read_log()).find((entry) => entry.kind === "argv")?.argv ?? [];
  assert.ok(resumed.includes(`--resume=${ref.session_id}`), resumed.join(" "));
  assert.equal(resumed.some((arg) => arg.startsWith("--session-id")), false);
  assert.deepEqual(second.saved, [{ ...ref, through_message_id: "turn-2" }]);
});

test("Stop in the middle of a tool call ends the turn stopped and the fake Claude Code exits", async () => {
  await write_scenario([[{ tool: "wait", input: {} }, { text: "never shown" }, { result: true }]]);
  let started: () => void = () => undefined;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait_tool = make_tool("wait", ({ ctx }) => {
    started();
    return new Promise((resolve) => ctx.signal.addEventListener("abort", () => resolve({ status: "failed", text: "aborted", view: null }), { once: true }));
  });
  const h = harness([wait_tool]);
  const done = run_claude_turn(h.session, h.input);
  await running;
  h.controller.abort(new Error("the user stopped the turn"));
  await done;
  assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  assert.deepEqual(open_steps(h.events), []);
  const log = await read_log();
  assert.ok(control(received(log), "interrupt").length >= 1);
  assert.ok(log.some((entry) => entry.kind === "stdin_closed"));
  const pid = log.find((entry) => entry.kind === "argv")?.pid;
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0));
});

test("an auth error from Claude Code ends the turn with claude_auth and asks for a new login probe", async () => {
  await write_scenario([[{ auth_error: true }]]);
  const before_failures = auth_failures;
  const h = harness([read_tool()]);
  await run_claude_turn(h.session, h.input);
  const [end] = ends(h.events);
  assert.equal(end?.type === "end" ? end.error?.kind : null, "claude_auth");
  assert.equal(auth_failures, before_failures + 1);
  assert.deepEqual(open_steps(h.events), []);
});

test("a subscription usage limit ends the turn with claude_limit", async () => {
  await write_scenario([[{ text: "Starting." }, { usage_limit: true }]]);
  const h = harness([read_tool()]);
  await run_claude_turn(h.session, h.input);
  const [end] = ends(h.events);
  assert.equal(end?.type === "end" ? end.error?.kind : null, "claude_limit");
  assert.match(end?.type === "end" ? (end.error?.message ?? "") : "", /five_hour/);
  assert.deepEqual(open_steps(h.events), []);
});

test("a resumed session that Claude Code no longer has starts one new seeded session in the same turn", async () => {
  await write_scenario([[{ missing_session: true }, { text: "Fresh start." }, { result: true }]]);
  const stored: ClaudeSessionRef = { session_id: "11111111-2222-4333-8444-555555555555", cwd: project, through_message_id: "turn-0" };
  const h = harness([read_tool()], { stored, previous_turn_id: "turn-0" });
  h.api_messages.splice(1, 0, { role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" });
  await run_claude_turn(h.session, h.input);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
  const log = await read_log();
  const runs = log.filter((entry) => entry.kind === "argv").map((entry) => entry.argv ?? []);
  assert.equal(runs.length, 2);
  assert.ok(runs[0]?.includes(`--resume=${stored.session_id}`));
  const fresh = runs[1]?.find((arg) => arg.startsWith("--session-id="))?.slice("--session-id=".length);
  assert.ok(fresh && fresh !== stored.session_id);
  assert.deepEqual(h.saved, [null, { session_id: fresh, cwd: project, through_message_id: "turn-1" }]);
  const seeded = received(log).filter((frame) => frame.type === "user").at(-1) as { message: { content: { type: string; text?: string }[] } } | undefined;
  const text = seeded?.message.content.map((block) => block.text ?? "").join("\n") ?? "";
  assert.match(text, /earlier question/);
  assert.match(text, /earlier answer/);
});

test("a steer sent during a tool call reaches the fake Claude Code with priority next and the turn ends once it is acknowledged", async () => {
  await write_scenario([[{ tool: "read", input: { path: "a.txt" } }, { text: "Switched to the other file." }, { result: true }]]);
  const steers: SteerMessage[] = [];
  const read = make_tool("read", async () => {
    steers.push({ id: "steer-1", text: "use the other file", at: 3, attachments: [] });
    return { status: "done", text: "content", view: null };
  });
  const source = {
    next: () => steers[0] ?? null,
    noted: async () => [],
    take: (steer_id: string) => {
      steers.splice(steers.findIndex((steer) => steer.id === steer_id), 1);
    },
  };
  const h = harness([read], { session: { steers: source } });
  await run_claude_turn(h.session, h.input);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
  assert.deepEqual(h.events.find((event) => event.type === "steer"), { type: "steer", round: 1, text: "use the other file", pushed_at: 3, steer_id: "steer-1" });
  const users = received(await read_log()).filter((frame) => frame.type === "user") as { priority?: string; client_composed?: boolean; message: { content: { text?: string }[] } }[];
  assert.equal(users.length, 2);
  assert.deepEqual([users[1]?.priority, users[1]?.client_composed], ["next", true]);
  assert.match(users[1]?.message.content.map((block) => block.text ?? "").join("") ?? "", /use the other file/);
});

test("a manual compaction resumes the session, sends /compact as a command and saves the summary from the PostCompact hook", async () => {
  await write_scenario([[{ compact: true }, { result: true }]]);
  const saved: CompactionRecord[] = [];
  const stored: ClaudeSessionRef = { session_id: "22222222-3333-4444-8555-666666666666", cwd: project, through_message_id: "turn-0" };
  const h = harness([read_tool()], {
    stored,
    previous_turn_id: "turn-0",
    session: { compaction: { audience: "user", facts: async () => "facts", save: async (record) => void saved.push(record) } },
    input: { compact_only: true },
  });
  await run_claude_turn(h.session, h.input);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
  assert.deepEqual(
    h.events.filter((event) => event.type === "compaction").map((event) => (event.type === "compaction" ? [event.status, event.source] : [])),
    [
      ["running", "manual"],
      ["done", "manual"],
    ],
  );
  assert.deepEqual(saved, [{ note: "Summary written by the fake Claude Code.", facts: "facts", through_round: -1 }]);
  const log = await read_log();
  assert.ok(log.find((entry) => entry.kind === "argv")?.argv?.includes(`--resume=${stored.session_id}`));
  const [command] = received(log).filter((frame) => frame.type === "user") as { client_composed?: boolean; message: { content: unknown } }[];
  assert.deepEqual([command?.message.content, command?.client_composed], ["/compact", undefined]);
});

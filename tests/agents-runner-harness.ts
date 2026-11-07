import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import { on_agent_event } from "../electron/agents/live.ts";
import { set_agent_continuation, type AgentReport, type AgentUpdate } from "../electron/agents/reports.ts";
import { init_agents, type DeployRequest } from "../electron/agents/runner.ts";
import type { ApiMessage, RoundResult } from "../electron/model/types.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { StreamFn } from "../electron/turn/session.ts";
import type { WorkflowReport } from "../electron/workflows/notice.ts";
import { review_stub } from "./review-stub.ts";

export const model: ModelEntry = {
  id: "test/model",
  label: "Test",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

export const flex_model: ModelEntry = { ...model, id: "test/flex-model", provider_order: ["test/default"], tiers: { flex: { provider_order: ["test/flex"] } } };

export const settings ={ custom_instructions: "", web_search: { topic: "general" } } as Settings;

export const completed = (over: Partial<RoundResult>): RoundResult => ({
  status: "completed",
  content: "",
  reasoning: "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "stop",
  usage: null,
  ...over,
});

export const cancelled = completed({ status: "cancelled", finish_reason: "" });

export type Script = (messages: ApiMessage[], signal: AbortSignal) => Promise<RoundResult>;

export const scripts = new Map<string, Script>();

export const tools: Tool[] = [];

export const reports: AgentReport[] = [];

export const updates: AgentUpdate[] = [];

export const workflow_notices: WorkflowReport[] = [];

export const events: AgentEvent[] = [];

export const reviewer = review_stub();

export let root = "";

export let project = "";

export const offered = new Map<string, number[]>();

export const stream: StreamFn = async (request, callbacks, signal) => {
  const user = request.messages.find((message) => message.role === "user");
  const prompt = typeof user?.content === "string" ? user.content : "";
  const script = scripts.get(prompt);
  if (!script) {
    throw new Error("no script for this prompt");
  }
  offered.set(prompt, [...(offered.get(prompt) ?? []), request.tools.length]);
  const result = await script(request.messages, signal);
  if (result.content) {
    callbacks.on_text(result.content);
  }
  return result;
};

export const request = (prompt: string, over: Partial<DeployRequest> = {}): DeployRequest => ({
  chat_id: "chat-runner",
  parent_message_id: "parent-msg",
  parent_call_id: "parent-call",
  project_root: project,
  user_request: "the user's request",
  mode: "ask",
  settings,
  prompt,
  name: "Reviewer",
  description: "reviews things",
  topic: "",
  scope: [],
  profile: "worker",
  without_tools: [],
  effort: "",
  model,
  ...over,
});

export const wait_for = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for agent state");
};

export const block_until_abort: Script = (_messages, signal) =>
  new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(cancelled), { once: true });
  });

export const start_runner = async (): Promise<void> => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agents-"));
  project = path.join(root, "project");
  await fs.mkdir(project);
  await init_agents({ dir: path.join(root, "agents"), stream, resolve_tools: () => tools, side_model: async () => "", review_call: reviewer.call, models: async () => [model, flex_model] });
  set_agent_continuation((notice) => {
    if (notice.kind === "report") {
      reports.push(notice.report);
      return;
    }
    if (notice.kind === "workflow") {
      workflow_notices.push(notice.workflow);
      return;
    }
    updates.push(notice.update);
  });
  on_agent_event((event) => events.push(event));
};

export const stop_runner = async (): Promise<void> => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
};

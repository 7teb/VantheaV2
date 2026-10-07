import type { ApprovalDecision } from "../approval.ts";
import type { AssistantMessage } from "../chat.ts";
import type { AgentEvent } from "../events.ts";
import { emit, invoke } from "./channel.ts";

export type AgentProfile = "explore" | "worker";

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type AgentRunSummary = {
  run_id: string;
  prompt: string;
  status: AgentRunStatus;
  started_at: string;
  ended_at: string | null;
  report: string;
};

export type AgentSummary = {
  agent_id: string;
  chat_id: string;
  name: string;
  description: string;
  model: string;
  profile: AgentProfile;
  runs: AgentRunSummary[];
};

export type AgentRun = AgentRunSummary &
  Pick<AssistantMessage, "steps" | "retry" | "error" | "context" | "last_seq"> & { agent_id: string; name: string };

export type BackgroundStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export type BackgroundTask = {
  id: string;
  chat_id: string;
  name: string;
  command: string;
  cwd: string;
  status: BackgroundStatus;
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
  output_tail: string;
};

export const work_channels = {
  "agents:list": invoke<[chat_id: string], AgentSummary[]>(),
  "agents:run": invoke<[agent_id: string, run_id: string], AgentRun | null>(),
  "agents:cancel": invoke<[agent_id: string], void>(),
  "agents:approve": invoke<[agent_id: string, run_id: string, call_id: string, decision: ApprovalDecision], void>(),
  "agents:changed": emit<AgentSummary>(),
  "agent:event": emit<AgentEvent>(),
  "background:list": invoke<[chat_id: string], BackgroundTask[]>(),
  "background:cancel": invoke<[task_id: string], void>(),
  "background:clear": invoke<[chat_id: string], void>(),
  "background:changed": emit<BackgroundTask>(),
} as const;

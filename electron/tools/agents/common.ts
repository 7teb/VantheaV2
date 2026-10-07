import type { AgentRunSummary, AgentSummary } from "../../../shared/ipc/work.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import type { AgentRecord } from "../../agents/records.ts";
import type { RunContext } from "../../agents/runner.ts";
import { find_agent } from "../../agents/store.ts";
import { require_string } from "../browser/common.ts";
import { ToolArgumentError, type ToolContext } from "../types.ts";

export const agent_id_property = { type: "string", description: "Agent id from deploy_agent, or a unique leading part of it." };

export const agent_view = (agent: Pick<AgentSummary, "agent_id" | "name">, run: AgentRunSummary): ToolView => ({
  kind: "agent",
  agent_id: agent.agent_id,
  run_id: run.run_id,
  name: agent.name,
  status: run.status,
  report: run.report,
});

export const read_agent_id = (raw: Record<string, unknown>): string => require_string(raw, "agent_id").trim();

export const read_text = (raw: Record<string, unknown>, key: string, max: number): string => {
  const text = require_string(raw, key).trim();
  if (!text) {
    throw new ToolArgumentError(`${key} must not be blank`);
  }
  if (text.length > max) {
    throw new ToolArgumentError(`${key} is longer than ${max} characters`);
  }
  return text;
};

export const resolve_agent = (ctx: ToolContext, id: string): AgentRecord => {
  const found = find_agent(id, ctx.chat_id);
  if (!found.agent) {
    throw new Error(found.error);
  }
  return found.agent;
};

export const run_context = (ctx: ToolContext, prompt: string): RunContext => ({
  chat_id: ctx.chat_id,
  parent_message_id: ctx.turn_id,
  project_root: ctx.project_root,
  user_request: ctx.user_request,
  authorization: ctx.authorization ?? (() => ctx.user_request),
  mode: ctx.mode,
  settings: ctx.settings,
  prompt,
});

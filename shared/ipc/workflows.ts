import type { WorkflowSummary } from "../workflow.ts";
import { emit, invoke } from "./channel.ts";

export const workflows_channels = {
  "workflows:list": invoke<[chat_id: string], WorkflowSummary[]>(),
  "workflows:get": invoke<[run_id: string], WorkflowSummary | null>(),
  "workflows:stop": invoke<[run_id: string], void>(),
  "workflows:skip_agent": invoke<[run_id: string, index: number], void>(),
  "workflows:changed": emit<WorkflowSummary>(),
} as const;

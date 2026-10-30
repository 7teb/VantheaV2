import type { Tool } from "../types.ts";
import { run_workflow_tool } from "./run.ts";
import { stop_workflow_tool } from "./stop.ts";

export const workflow_tools: Tool[] = [run_workflow_tool, stop_workflow_tool];

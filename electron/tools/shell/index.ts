import type { Tool } from "../types.ts";
import { cancel_background_task_tool, get_background_task_tool, start_background_task_tool } from "./background.ts";
import { run_command_tool } from "./run-command.ts";

export const shell_tools: Tool[] = [run_command_tool, start_background_task_tool, get_background_task_tool, cancel_background_task_tool];

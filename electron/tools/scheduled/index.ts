import type { Tool } from "../types.ts";
import { delete_scheduled_task_tool } from "./delete.ts";
import { list_scheduled_tasks_tool } from "./list.ts";
import { save_scheduled_task_tool } from "./save.ts";

export const scheduled_tools: Tool[] = [list_scheduled_tasks_tool, save_scheduled_task_tool, delete_scheduled_task_tool];

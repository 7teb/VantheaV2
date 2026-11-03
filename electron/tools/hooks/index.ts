import type { Tool } from "../types.ts";
import { delete_hook_tool } from "./delete.ts";
import { list_hooks_tool } from "./list.ts";
import { save_hook_tool } from "./save.ts";

export const hook_tools: Tool[] = [list_hooks_tool, save_hook_tool, delete_hook_tool];

import type { Tool } from "../types.ts";
import { cancel_agent_tool, get_agent_status_tool, message_agent_tool } from "./manage.ts";
import { message_main_agent_tool } from "./message-main.ts";
import { continue_agent_tool, deploy_agent_tool } from "./start.ts";

export const agent_tools: Tool[] = [deploy_agent_tool, continue_agent_tool, get_agent_status_tool, cancel_agent_tool, message_agent_tool, message_main_agent_tool];

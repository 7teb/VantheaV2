import type { ModelEntry } from "../../shared/models.ts";
import type { Settings } from "../../shared/settings.ts";
import { agent_tools } from "./agents/index.ts";
import { read_attachment_tool } from "./attachments/index.ts";
import { browser_tools } from "./browser/index.ts";
import { check_page_tool } from "./check/index.ts";
import { fs_tools } from "./fs/index.ts";
import { generate_image_tool } from "./image/index.ts";
import { present_images_tool } from "./image/present.ts";
import { show_images_tool } from "./image/show.ts";
import { add_mcp_server_tool } from "./mcp/add-server.ts";
import { memory_tools } from "./memory/index.ts";
import { meta_tools } from "./meta/index.ts";
import { list_models_tool } from "./meta/models.ts";
import { shell_tools } from "./shell/index.ts";
import { skill_tools } from "./skills/index.ts";
import type { Tool, ToolProfile } from "./types.ts";
import { vision_tools } from "./vision/index.ts";
import { visualize_tool } from "./visual/index.ts";
import { web_search_tool } from "./web/index.ts";
import { workflow_tools } from "./workflows/index.ts";

const groups: Tool[][] = [
  fs_tools,
  shell_tools,
  meta_tools,
  [list_models_tool],
  vision_tools,
  browser_tools,
  [add_mcp_server_tool],
  [web_search_tool],
  [generate_image_tool, present_images_tool, show_images_tool],
  [visualize_tool],
  [read_attachment_tool],
  memory_tools,
  skill_tools,
  [check_page_tool],
  agent_tools,
  workflow_tools,
];

const all_tools = () => groups.flat();

export const tools_for = (profile: ToolProfile, settings: Settings, model: ModelEntry, dynamic: Tool[] = []): Tool[] =>
  [...all_tools(), ...dynamic].filter((tool) => tool.profiles.includes(profile) && tool.available(settings, model));

export const find_tool = (name: string, dynamic: Tool[] = []): Tool | null =>
  [...all_tools(), ...dynamic].find((tool) => tool.spec.name === name) ?? null;

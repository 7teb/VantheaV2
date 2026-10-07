import type { Tool } from "../types.ts";
import { browser_click_tool, browser_key_tool, browser_scroll_tool, browser_snapshot_tool, browser_type_tool, browser_wait_tool } from "./page.ts";
import { browser_navigate_tool, browser_tab_tool, browser_tabs_tool } from "./tabs.ts";
import { browser_visual_analyze_tool, browser_visual_click_tool } from "./visual.ts";

export const browser_tools: Tool[] = [
  browser_tabs_tool,
  browser_tab_tool,
  browser_navigate_tool,
  browser_snapshot_tool,
  browser_click_tool,
  browser_type_tool,
  browser_key_tool,
  browser_scroll_tool,
  browser_wait_tool,
  browser_visual_analyze_tool,
  browser_visual_click_tool,
];

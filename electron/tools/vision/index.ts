import type { Tool } from "../types.ts";
import { analyze_image_tool } from "./analyze-image.ts";
import { view_image_tool } from "./view-image.ts";

export const vision_tools: Tool[] = [analyze_image_tool, view_image_tool];

import type { Tool } from "../types.ts";
import { list_files_tool, read_file_tool } from "./read.ts";
import { get_file_outline_tool, grep_files_tool } from "./search.ts";
import { replace_in_file_tool, write_file_tool } from "./write.ts";

export const fs_tools: Tool[] = [list_files_tool, read_file_tool, grep_files_tool, get_file_outline_tool, write_file_tool, replace_in_file_tool];

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";

const binary_module = "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe";

export const claude_executable = (): string => {
  let resolved: string;
  try {
    resolved = createRequire(import.meta.url).resolve(binary_module);
  } catch (error) {
    throw new Error(`the Claude Code executable ${binary_module} is not installed: ${error_text(error)}`);
  }
  const unpacked = resolved.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  if (!existsSync(unpacked)) {
    throw new Error(`the Claude Code executable is missing at ${unpacked}`);
  }
  return unpacked;
};

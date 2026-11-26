import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { error_code, error_text } from "../storage/coerce.ts";

export const default_max_running_agents = 20;

export const user_config_file = (home = os.homedir()): string => path.join(home, ".VantheaX", "config.json");

export const ensure_user_config = (file = user_config_file()): void => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ max_running_agents: default_max_running_agents }, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error_code(error) === "EEXIST") {
      return;
    }
    console.error(`[config] creating ${file} failed, the agent limit stays at ${default_max_running_agents}: ${error_text(error)}`);
  }
};

const configured_limit = (text: string, file: string): number => {
  let value: unknown;
  try {
    value = (JSON.parse(text.replace(/^﻿/, "")) as { max_running_agents?: unknown } | null)?.max_running_agents;
  } catch (error) {
    console.warn(`[config] ${file} is not valid JSON, the agent limit stays at ${default_max_running_agents}: ${error_text(error)}`);
    return default_max_running_agents;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  console.warn(`[config] max_running_agents in ${file} is ${JSON.stringify(value)}, not a whole number above 0, so the limit stays at ${default_max_running_agents}`);
  return default_max_running_agents;
};

export const max_running_agents = (file = user_config_file()): number => {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error_code(error) !== "ENOENT") {
      console.warn(`[config] reading ${file} failed, the agent limit stays at ${default_max_running_agents}: ${error_text(error)}`);
    }
    return default_max_running_agents;
  }
  return configured_limit(text, file);
};

import fs from "node:fs";
import path from "node:path";
import { error_text } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";

export type HeadlessConfig = { port: number; data_dir: string; app_dir: string; lease_stdin: boolean; token: string; openrouter_key: string };

type LaunchSwitches = { has(name: string): boolean; value(name: string): string };

type RealPath = (target: string) => string;

const min_token_length = 32;

export const path_within = (root: string, target: string): boolean => {
  const [base, key] = [path_key(root), path_key(target)];
  return key === base || key.startsWith(`${base}/`);
};

const overlaps = (first: string, second: string): boolean => path_within(first, second) || path_within(second, first);

export const real_path = (target: string): string => {
  const missing: string[] = [];
  let current = path.resolve(target);
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(fs.realpathSync.native(current), ...missing);
};

const failed = (message: string) => ({ kind: "error" as const, message });

export const parse_launch = (
  switches: LaunchSwitches,
  env: Record<string, string | undefined>,
  app_data: string,
  resolve_real: RealPath,
): { kind: "gui" } | { kind: "headless"; config: HeadlessConfig } | { kind: "error"; message: string } => {
  if (!switches.has("vx-serve")) {
    return { kind: "gui" };
  }
  const port_text = switches.has("vx-port") ? switches.value("vx-port") : "0";
  if (!/^\d{1,5}$/.test(port_text) || Number(port_text) > 65535) {
    return failed(`--vx-port must be an integer from 0 to 65535, got "${port_text}"`);
  }
  const data_dir_text = switches.has("vx-data-dir") ? switches.value("vx-data-dir") : path.join(app_data, "VantheaX-headless");
  if (!path.isAbsolute(data_dir_text)) {
    return failed(`--vx-data-dir must be an absolute path, got "${data_dir_text}"`);
  }
  let data_dir: string;
  let app_dir: string;
  try {
    data_dir = resolve_real(path.resolve(data_dir_text));
    app_dir = resolve_real(path.join(app_data, "VantheaX"));
  } catch (error) {
    return failed(`--vx-data-dir ${data_dir_text} or the VantheaX app data folder cannot be resolved: ${error_text(error)}`);
  }
  if (overlaps(data_dir, app_dir)) {
    return failed(`--vx-data-dir ${data_dir} must not be the VantheaX app data folder ${app_dir}, lie inside it or contain it`);
  }
  const lease_stdin = switches.has("vx-lease");
  if (lease_stdin && switches.value("vx-lease") !== "stdin") {
    return failed(`--vx-lease only accepts "stdin", got "${switches.value("vx-lease")}"`);
  }
  const token = env.VANTHEAX_API_TOKEN ?? "";
  if (!token) {
    return failed("VANTHEAX_API_TOKEN must be set when VantheaX starts with --vx-serve");
  }
  if (token.length < min_token_length) {
    return failed(`VANTHEAX_API_TOKEN must be at least ${min_token_length} characters, it has ${token.length}`);
  }
  return { kind: "headless", config: { port: Number(port_text), data_dir, app_dir, lease_stdin, token, openrouter_key: env.OPENROUTER_API_KEY ?? "" } };
};

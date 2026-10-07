import type { BrowserCommandResult, BrowserTabRegistration } from "../../shared/ipc/panels.ts";
import { browser_partition } from "../browser/guest-policy.ts";
import { wipe_browser_storage } from "../browser/guest-security.ts";
import { register_tab, resolve_command, set_active_tab, unregister_tab } from "../browser/tabs.ts";
import { handle } from "./handle.ts";

const require_text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
};

const nullable_text = (value: unknown, field: string) => (value === null ? null : require_text(value, field));

const valid_registration = (value: BrowserTabRegistration): BrowserTabRegistration => {
  if (!Number.isSafeInteger(value?.web_contents_id) || value.web_contents_id <= 0) {
    throw new Error("web_contents_id must be a positive integer");
  }
  return { tab_id: require_text(value.tab_id, "tab_id"), web_contents_id: value.web_contents_id, url: typeof value.url === "string" ? value.url : "" };
};

const valid_result = (value: BrowserCommandResult): BrowserCommandResult => {
  if (typeof value?.ok !== "boolean") {
    throw new Error("ok must be a boolean");
  }
  return {
    command_id: require_text(value.command_id, "command_id"),
    ok: value.ok,
    tab_id: value.tab_id === null || value.tab_id === undefined ? null : require_text(value.tab_id, "tab_id"),
    error: value.error === null || value.error === undefined ? null : String(value.error).slice(0, 500),
  };
};

export const register_browser_ipc = () => {
  handle("browser:register_tab", (registration) => register_tab(valid_registration(registration)));
  handle("browser:unregister_tab", (tab_id) => unregister_tab(require_text(tab_id, "tab_id")));
  handle("browser:set_active_tab", (tab_id) => set_active_tab(nullable_text(tab_id, "tab_id")));
  handle("browser:command_result", (result) => resolve_command(valid_result(result)));
  handle("browser:wipe", () => wipe_browser_storage());
  handle("browser:partition", () => browser_partition);
};

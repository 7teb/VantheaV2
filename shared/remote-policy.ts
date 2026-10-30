import type { EventName, InvokeName, SendName } from "./ipc/index.ts";

export const remote_refused: ReadonlySet<InvokeName | SendName> = new Set<InvokeName | SendName>([
  "window:minimize",
  "window:toggle_maximize",
  "window:close",
  "window:fullscreen",
  "window:state",
  "window:zoom",
  "shell:open_external",
  "shell:reveal_path",
  "projects:choose",
  "projects:pick_folder",
  "projects:open",
  "artifacts:export",
  "mcp:detect_folder",
  "skills:open_folder",
  "files:reveal",
  "browser:tabs",
  "browser:open",
  "browser:close",
  "browser:select",
  "browser:load",
  "browser:history",
  "browser:freeze",
  "browser:viewport",
  "remote:status",
  "remote:set_enabled",
  "remote:renew_link",
]);

export const remote_local_channels: ReadonlySet<InvokeName> = new Set<InvokeName>(["window:state", "shell:open_external", "artifacts:export"]);

export const remote_hidden_events: ReadonlySet<EventName> = new Set<EventName>(["window:changed", "remote:changed", "browser:changed"]);

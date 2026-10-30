import { on_remote_change, remote_status, renew_remote_link, set_remote_enabled } from "../remote/server.ts";
import { require_boolean } from "../storage/coerce.ts";
import { window_client } from "./clients.ts";
import { emit_to, handle } from "./handle.ts";

export const register_remote_ipc = () => {
  on_remote_change((status) => emit_to(window_client, "remote:changed", status));
  handle("remote:status", () => remote_status());
  handle("remote:set_enabled", (enabled) => set_remote_enabled(require_boolean(enabled, "LAN access enabled")));
  handle("remote:renew_link", () => renew_remote_link());
};

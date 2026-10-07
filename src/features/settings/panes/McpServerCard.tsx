import { useState } from "react";
import type { McpServerStatus } from "../../../../shared/ipc/extensions.ts";
import { IconButton } from "../../../components/Button.tsx";
import { Collapsible } from "../../../components/Collapsible.tsx";
import { ConfirmDialog } from "../../../components/Dialog.tsx";
import { RetryIcon, TrashIcon } from "../../../components/icons.tsx";
import { Toggle } from "../../../components/Toggle.tsx";
import { use_t, type Translate } from "../../../i18n/index.ts";
import { reconnect_mcp_server, remove_mcp_server, set_mcp_trust, upsert_mcp_server } from "../../../state/extensions.ts";
import { SettingsGroup, SettingsRow } from "../SettingsLayout.tsx";
import { ipc_error_text } from "./ipc-error.ts";
import { McpToolList } from "./McpToolList.tsx";

const state_label = (t: Translate, server: McpServerStatus) => {
  switch (server.state) {
    case "ready":
      return t("mcp.status_ready", { n: server.tools.length });
    case "starting":
      return t("mcp.status_starting");
    case "error":
      return t("mcp.status_error");
    case "stopped":
      return server.config.enabled ? t("mcp.status_stopped") : t("mcp.status_disabled");
  }
};

const command_line = (server: McpServerStatus) => [server.config.command, ...server.config.args].join(" ");

export const McpServerCard = ({ server }: { server: McpServerStatus }) => {
  const t = use_t();
  const [confirming, set_confirming] = useState(false);
  const [busy, set_busy] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const gated = server.tools.some((tool) => tool.tier === "dangerous" || tool.tier === "shell_system");

  const run = async (label: string, action: () => Promise<void>) => {
    set_busy(true);
    set_error(null);
    try {
      await action();
    } catch (failure) {
      console.error(`[settings] ${label} failed for MCP server ${server.name}`, failure);
      set_error(ipc_error_text(failure));
    } finally {
      set_busy(false);
    }
  };

  const title = (
    <span className="mcp-title">
      <span>{server.name}</span>
      <span className="mcp-badge" data-state={server.config.enabled ? server.state : "disabled"}>
        {state_label(t, server)}
      </span>
    </span>
  );

  return (
    <SettingsGroup>
      <div className="settings-row mcp-head">
        <div className="settings-row-text">
          <div className="settings-row-label">{title}</div>
          <div className="settings-row-hint mcp-command" title={command_line(server)}>
            {command_line(server)}
          </div>
        </div>
        <div className="settings-row-control">
          <IconButton
            size="sm"
            label={t("mcp.reconnect")}
            disabled={busy || !server.config.enabled}
            onClick={() => void run("mcp:reconnect", () => reconnect_mcp_server(server.name))}
          >
            <RetryIcon size={14} />
          </IconButton>
          <IconButton size="sm" label={t("mcp.remove")} disabled={busy} onClick={() => set_confirming(true)}>
            <TrashIcon size={14} />
          </IconButton>
          <Toggle
            checked={server.config.enabled}
            disabled={busy}
            label={t("mcp.server_enabled", { x: server.name })}
            on_change={(enabled) => void run("mcp:upsert", () => upsert_mcp_server(server.name, { ...server.config, enabled }))}
          />
        </div>
      </div>
      {(server.error || error) && (
        <div className="settings-row mcp-error" role="alert">
          {error ?? server.error}
        </div>
      )}
      {gated && (
        <SettingsRow label={t("mcp.trust_dangerous")} hint={t("mcp.trust_sub")}>
          <Toggle
            checked={server.trusted}
            label={t("mcp.trust_dangerous")}
            on_change={(trusted) => void run("mcp:set_trust", () => set_mcp_trust(server.name, trusted))}
          />
        </SettingsRow>
      )}
      {server.state === "ready" && (
        <div className="settings-row mcp-section">
          <Collapsible header={`${t("mcp.tools")} · ${server.tools.length}`}>
            <McpToolList server={server} />
          </Collapsible>
        </div>
      )}
      {server.stderr_tail && (
        <div className="settings-row mcp-section">
          <Collapsible header={t("mcp.log")}>
            <pre className="pane-code inset-surface">{server.stderr_tail}</pre>
          </Collapsible>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={t("mcp.remove_title", { x: server.name })}
        detail={command_line(server)}
        confirm_label={t("mcp.remove")}
        cancel_label={t("common.cancel")}
        danger
        on_confirm={() => void run("mcp:remove", () => remove_mcp_server(server.name))}
        on_close={() => set_confirming(false)}
      />
    </SettingsGroup>
  );
};
